package spectrum

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	voicedomain "Opinions-sur-Rue/spectrum/domain/voice"
	"github.com/gorilla/websocket"
)

const gatewaySecret = "public-voice-gateway-test-secret-not-for-production"

func gatewayFixture(t *testing.T, upstream http.Handler) (*Hub, *Client, *Client, *Room, *voicedomain.Client, string) {
	t.Helper()
	hub, admin, actor, room, _ := voiceFixture(t)
	server := httptest.NewServer(upstream)
	t.Cleanup(server.Close)
	driver, err := voicedomain.New(voicedomain.Config{InternalURL: server.URL, URL: "ws://localhost/spectrum/voice", Key: "gateway-test", Secret: gatewaySecret})
	if err != nil {
		t.Fatal(err)
	}
	hub.voiceBackend = driver
	token, err := driver.JoinToken(room.voiceRoomID, room.memberIDs[actor.userID], true, room.voiceAdmissions[room.memberIDs[actor.userID]])
	if err != nil {
		t.Fatal(err)
	}
	return hub, admin, actor, room, driver, token
}

func gateRequest(hub *Hub, path, token string) int {
	r := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/spectrum/voice"+path+"?access_token="+url.QueryEscape(token), nil)
	w := httptest.NewRecorder()
	hub.VoiceSignal(w, r)
	return w.Code
}

func TestVoiceGateRejectsOldTokensAcrossDemotionAndKick(t *testing.T) {
	hub, admin, actor, room, driver, old := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	if gateRequest(hub, "/rtc/validate", old) != http.StatusOK {
		t.Fatal("valid participant refused")
	}
	physical, generation := room.voiceRoomID, room.voiceGeneration
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if room.voiceRoomID != physical || room.voiceGeneration != generation {
		t.Fatal("demotion retired room")
	}
	if gateRequest(hub, "/rtc/validate", old) != http.StatusForbidden {
		t.Fatal("old publisher token admitted after demotion")
	}
	identity := room.memberIDs[actor.userID]
	room.voiceAdmissions[identity] = "fresh-listener-epoch"
	listener, _ := driver.JoinToken(physical, identity, false, room.voiceAdmissions[identity])
	if gateRequest(hub, "/rtc/validate", listener) != http.StatusOK {
		t.Fatal("current listener refused")
	}
	if err := handleRoomKick(admin, stageEnvelope(t, "room.kick", identity)); err != nil {
		t.Fatal(err)
	}
	if gateRequest(hub, "/rtc/validate", listener) != http.StatusForbidden {
		t.Fatal("kicked listener token admitted")
	}
	// A later normal room rejoin must not revive any previous membership token.
	if err := hub.JoinSpectator(room.id, actor.userID); err != nil {
		t.Fatal(err)
	}
	room.voiceAdmissions[identity] = "new-membership-epoch"
	if gateRequest(hub, "/rtc/validate", listener) != http.StatusForbidden {
		t.Fatal("old membership token revived")
	}
	if room.voiceRoomID != physical {
		t.Fatal("kick disrupted remaining participants")
	}
}

func TestVoiceGateRejectsUnsafePathsAndTokens(t *testing.T) {
	calls := 0
	hub, _, _, _, _, token := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(http.StatusOK) }))
	for _, path := range []string{"/twirp/livekit.RoomService/DeleteRoom", "/rtc/admin", "/rtc/../twirp", "//rtc"} {
		if gateRequest(hub, path, token) != http.StatusNotFound {
			t.Fatalf("unsafe path accepted: %s", path)
		}
	}
	if gateRequest(hub, "/rtc/validate", "forged") != http.StatusForbidden {
		t.Fatal("forged token admitted")
	}
	if calls != 0 {
		t.Fatal("unsafe request reached SFU")
	}
}

func TestVoiceGateHoldsBarrierUntilSFUParticipantIsRegistered(t *testing.T) {
	starting, proceed, updated := make(chan struct{}), make(chan struct{}), make(chan struct{})
	hub, admin, actor, room, _, token := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/UpdateParticipant") {
			close(updated)
			w.WriteHeader(http.StatusOK)
			return
		}
		close(starting)
		<-proceed
		upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_, _, _ = conn.ReadMessage()
	}))
	gate := httptest.NewServer(http.HandlerFunc(hub.VoiceSignal))
	defer gate.Close()
	dialed := make(chan *websocket.Conn, 1)
	go func() {
		conn, response, _ := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(gate.URL, "http")+"/spectrum/voice/rtc?access_token="+url.QueryEscape(token), nil)
		if response != nil {
			response.Body.Close()
		}
		dialed <- conn
	}()
	select {
	case <-starting:
	case <-time.After(time.Second):
		t.Fatal("upstream handshake not reached")
	}
	demoted := make(chan error, 1)
	go func() {
		demoted <- handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID]))
	}()
	select {
	case <-updated:
		t.Fatal("role change raced past pending SFU registration")
	case <-time.After(30 * time.Millisecond):
	}
	close(proceed)
	select {
	case conn := <-dialed:
		if conn == nil {
			t.Fatal("proxy upgrade failed")
		}
		defer conn.Close()
	case <-time.After(time.Second):
		t.Fatal("websocket proxy stalled")
	}
	select {
	case err := <-demoted:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("barrier held for websocket lifetime")
	}
	if gateRequest(hub, "/rtc/validate", token) != http.StatusForbidden {
		t.Fatal("revoked token admitted")
	}
}
