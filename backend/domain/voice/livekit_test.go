package voice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
)

const testSecret = "public-test-fixture-secret-at-least-32-characters"

func testClient(t *testing.T, internal string) *Client {
	t.Helper()
	client, err := New(Config{InternalURL: internal, URL: "ws://127.0.0.1:7880", Key: "test-key", Secret: testSecret})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestJoinGrantsAreExplicitAndAudioOnly(t *testing.T) {
	client := testClient(t, "http://127.0.0.1:7880")
	for _, publish := range []bool{false, true} {
		raw, err := client.JoinToken(Namespace+"room", "public-member", publish)
		if err != nil {
			t.Fatal(err)
		}
		verifier, err := auth.ParseAPIToken(raw)
		if err != nil {
			t.Fatal(err)
		}
		claims, err := verifier.Verify(testSecret)
		if err != nil {
			t.Fatal(err)
		}
		grant := claims.Video
		if claims.Identity != "public-member" || grant.Room != Namespace+"room" || !grant.RoomJoin || grant.GetCanPublish() != publish || !grant.GetCanSubscribe() {
			t.Fatal("incorrect participant grant")
		}
		if grant.RoomCreate || grant.RoomAdmin || grant.RoomList || grant.GetCanPublishData() || grant.GetCanUpdateOwnMetadata() {
			t.Fatal("excessive participant privileges")
		}
		if grant.GetCanPublishSource(livekit.TrackSource_CAMERA) || grant.GetCanPublishSource(livekit.TrackSource_SCREEN_SHARE) {
			t.Fatal("video publishing was allowed")
		}
		if grant.GetCanPublishSource(livekit.TrackSource_MICROPHONE) != publish {
			t.Fatal("microphone grant mismatch")
		}
	}
}

func TestPrepareFailsClosedOnAutomaticRoomCreation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	defer server.Close()
	if err := testClient(t, server.URL).Prepare(context.Background()); err != ErrUnsafeConfiguration {
		t.Fatalf("unsafe configuration accepted: %v", err)
	}
}

func TestPreparePurgesOnlyItsNamespace(t *testing.T) {
	var deleted []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/rtc/validate") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Error("missing API authentication")
		}
		switch r.URL.Path {
		case "/twirp/livekit.RoomService/ListRooms":
			_, _ = w.Write([]byte(`{"rooms":[{"name":"spectrum_abandoned"},{"name":"other-application"}]}`))
		case "/twirp/livekit.RoomService/DeleteRoom":
			var payload struct {
				Room string `json:"room"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
			}
			deleted = append(deleted, payload.Room)
			_, _ = w.Write([]byte(`{}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client := testClient(t, server.URL)
	if err := client.Prepare(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := client.Prepare(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 1 || deleted[0] != "spectrum_abandoned" {
		t.Fatalf("unexpected cleanup: %v", deleted)
	}
}

func TestPlaintextPublicVoiceURLIsLoopbackOnly(t *testing.T) {
	_, err := New(Config{InternalURL: "http://internal:7880", URL: "ws://192.0.2.10:7880", Key: "key", Secret: testSecret})
	if err == nil {
		t.Fatal("insecure public signaling allowed")
	}
}

func TestInvalidEnvironmentDoesNotReturnTypedNilBackend(t *testing.T) {
	t.Setenv("SPECTRUM_VOICE_ENABLED", "true")
	t.Setenv("LIVEKIT_INTERNAL_URL", "")
	backend, err := FromEnv()
	if backend != nil || err == nil {
		t.Fatal("invalid configuration returned a usable backend")
	}
}
