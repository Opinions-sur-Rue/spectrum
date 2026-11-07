package spectrum

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"Opinions-sur-Rue/spectrum/domain/social"
	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func liveFixture(t *testing.T) (*Hub, *Client, *Client, *Room, *liveSession) {
	t.Helper()
	h, admin, guest, room := stageFixture(t)
	session := &liveSession{platform: "twitch", status: "connected", users: make(map[string]*liveUser), cancel: func() {}}
	room.live = session
	t.Cleanup(h.shutdownLive)
	return h, admin, guest, room, session
}

func TestLiveVotesValidateBoundAndKeepLatestPerUser(t *testing.T) {
	h, _, _, room, session := liveFixture(t)
	for _, invalid := range []string{"hello", "spectrum 4", "spectrum 999", "spectrum 2 extra", "spectrum NaN"} {
		h.ingestLive(room.id, session, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, "external-a", "Alice", "", invalid))
	}
	if len(session.users) != 0 {
		t.Fatal("invalid votes imported")
	}
	for _, vote := range []string{"spectrum -2", "spectrum 2"} {
		h.ingestLive(room.id, session, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, "external-a", "Alice", "", vote))
	}
	if len(session.users) != 1 || *session.users["external-a"].Vote != 2 {
		t.Fatal("votes not latest per user")
	}
	for i := 0; i < liveUserLimit+10; i++ {
		h.ingestLive(room.id, session, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, strings.Repeat("x", i%10)+string(rune(i+100)), "Bob", "", "spectrum i"))
	}
	if len(session.users) != liveUserLimit {
		t.Fatal("live user cap", len(session.users))
	}
}

func TestLiveAggregateMovesToIndifferentWhenLatestVotesAreIndifferent(t *testing.T) {
	h, _, _, room, session := liveFixture(t)
	if len(room.livePellets()) != 0 {
		t.Fatal("empty session has an aggregate")
	}
	for _, vote := range []string{"spectrum 2", "spectrum i"} {
		h.ingestLive(room.id, session, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, "external-a", "Alice", "", vote))
	}
	pellets := room.livePellets()
	if len(pellets) != 1 || pellets[0].MemberID != "live_average" || pellets[0].X != 490 || pellets[0].Y != 450 {
		t.Fatal("latest indifferent vote did not replace directional aggregate", pellets)
	}
}

func TestLiveSnapshotsNeverLeakPlatformIDsAndRespectHiddenPositions(t *testing.T) {
	h, admin, guest, room, session := liveFixture(t)
	h.ingestLive(room.id, session, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, "private-twitch-user-id", "<b>Alice</b>", "https://tracker.invalid/a.png", "spectrum 2"))
	id := session.users["private-twitch-user-id"].ID
	selectUser := socialEnvelope(t, "live.select", map[string]any{"id": id, "selected": true})
	if err := handleLiveSelect(guest, selectUser); err == nil {
		t.Fatal("spectator selected external voter")
	}
	if err := handleLiveSelect(admin, socialEnvelope(t, "live.select", map[string]any{"id": "private-twitch-user-id", "selected": true})); err == nil {
		t.Fatal("raw platform ID accepted")
	}
	if err := handleLiveSelect(admin, selectUser); err != nil {
		t.Fatal(err)
	}
	state := room.liveFor(RoleAdmin)
	raw, _ := json.Marshal(state)
	if strings.Contains(string(raw), "private-twitch") || strings.Contains(string(raw), "tracker.invalid") {
		t.Fatal("external identifiers or avatar leaked")
	}
	if len(state.Users) != 1 || state.Users[0].ID != id {
		t.Fatal("admin voter list missing")
	}
	if len(room.liveFor(RoleSpectator).Users) != 0 {
		t.Fatal("spectator received admin voter list")
	}
	if len(room.spectrumFor(guest.userID, RoleSpectator).Pellets) != 3 {
		t.Fatal("visible live aggregate/selection missing")
	}
	room.participantsHidden = true
	if len(room.spectrumFor(guest.userID, RoleSpectator).Pellets) != 0 {
		t.Fatal("hidden external positions exposed")
	}
	if len(room.spectrumFor(admin.userID, RoleAdmin).Pellets) != 3 {
		t.Fatal("admin lost hidden positions")
	}
	room.participantsHidden = false
	room.settings.PelletsVisibleToSpectators = false
	if len(room.spectrumFor(guest.userID, RoleSpectator).Pellets) != 0 {
		t.Fatal("spectator visibility ignored")
	}
}

func TestLiveDisconnectAndStopFenceLateCallbacks(t *testing.T) {
	h, admin, _, room, session := liveFixture(t)
	request := socialEnvelope(t, "live.disconnect", struct{}{})
	if err := handleLiveDisconnect(admin, request); err != nil {
		t.Fatal(err)
	}
	event := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, "external", "Alice", "", "spectrum 2")
	h.ingestLive(room.id, session, event)
	if len(session.users) != 0 || room.live != nil {
		t.Fatal("retired callback revived room live state")
	}
	room.live = &liveSession{platform: "youtube", status: "connected", users: make(map[string]*liveUser), cancel: func() {}}
	h.ingestLive(room.id, session, event)
	if len(room.live.users) != 0 {
		t.Fatal("old connection contaminated new connection")
	}
	if err := handleRoomStop(admin, request); err != nil {
		t.Fatal(err)
	}
	h.ingestLive(room.id, session, event)
	if h.rooms[room.id] != nil {
		t.Fatal("callback resurrected stopped room")
	}
}

type fakeLiveListener struct {
	ready   func()
	started chan struct{}
	stopped chan struct{}
}

func (f *fakeLiveListener) SetOnReady(fn func())    { f.ready = fn }
func (f *fakeLiveListener) SetSecret(string)        {}
func (f *fakeLiveListener) SetMessageFilter(string) {}
func (f *fakeLiveListener) GetType() string         { return "twitch" }
func (f *fakeLiveListener) Disconnect() error       { return nil }
func (f *fakeLiveListener) Connect(ctx context.Context, _ string, _ social.OnEvent) error {
	if f.ready != nil {
		f.ready()
	}
	close(f.started)
	<-ctx.Done()
	close(f.stopped)
	return nil
}

func TestLiveConnectIsAdminOnlyCancelsOnRoomCloseAndHasNoImplicitTikTokCloud(t *testing.T) {
	h, admin, guest, room := stageFixture(t)
	t.Setenv("SPECTRUM_TIKTOK_SIGNER_URL", "")
	fake := &fakeLiveListener{started: make(chan struct{}), stopped: make(chan struct{})}
	calls := 0
	h.liveFactory = func(_, _, _ string) (social.ChatListener, error) { calls++; return fake, nil }
	request := socialEnvelope(t, "live.connect", map[string]string{"platform": "twitch", "channel": "test_channel", "secret": "never-broadcast-this"})
	if err := handleLiveConnect(guest, request); err == nil || calls != 0 {
		t.Fatal("spectator started live connection")
	}
	if err := handleLiveConnect(admin, socialEnvelope(t, "live.connect", map[string]string{"platform": "tiktok", "channel": "test"})); err == nil || calls != 0 {
		t.Fatal("implicit TikTok cloud connection")
	}
	if err := handleLiveConnect(admin, request); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.started:
	case <-time.After(time.Second):
		t.Fatal("listener not started")
	}
	h.WithRoomRead(room.id, func(r *Room) {
		raw, _ := json.Marshal(r.liveFor(RoleAdmin))
		if strings.Contains(string(raw), "never-broadcast-this") {
			t.Error("credential leaked")
		}
	})
	if err := handleRoomStop(admin, request); err != nil {
		t.Fatal(err)
	}
	select {
	case <-fake.stopped:
	case <-time.After(time.Second):
		t.Fatal("room close left listener running")
	}
}
