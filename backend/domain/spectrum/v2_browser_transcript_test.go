package spectrum

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func browserTranscriptFixture(t *testing.T) (*Hub, *Client, *Client, *Room) {
	t.Helper()
	t.Setenv("SPECTRUM_TRANSCRIPTION_ENABLED", "true")
	t.Setenv("SPECTRUM_TRANSCRIPTION_MODE", transcriptionModeBrowser)
	h, admin, actor, room, _ := voiceFixture(t)
	return h, admin, actor, room
}

func browserEnvelope(t *testing.T, op string, payload any) *valueobjects.Envelope {
	t.Helper()
	e, err := valueobjects.NewEnvelope(op, payload)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func startBrowserTranscript(t *testing.T, c *Client, room *Room) string {
	t.Helper()
	if err := handleBrowserTranscriptStart(c, browserEnvelope(t, "transcript.start", map[string]any{"requestId": "request", fieldGeneration: room.voiceGeneration, "consent": true})); err != nil {
		t.Fatal(err)
	}
	var event valueobjects.Envelope
	if err := json.Unmarshal(<-c.send, &event); err != nil {
		t.Fatal(err)
	}
	if event.Op != "transcript.started" {
		t.Fatalf("unexpected event: %s", event.Op)
	}
	return room.browserTranscripts[room.memberIDs[c.userID]].id
}

func TestBrowserTranscriptIsOptionalAndNeverSubscribesServerWorker(t *testing.T) {
	h, _, actor, room := browserTranscriptFixture(t)
	credentials, err := actor.issueVoiceCredentialsWithConsent(false)
	if err != nil || !credentials.CanPublish {
		t.Fatal("browser opt-in incorrectly gates voice", err)
	}
	if _, err := h.TranscriptionJobs(); err != ErrTranscriptDisabled {
		t.Fatal("browser mode granted server worker admission", err)
	}
	if _, err := h.AppendWorkerTranscript(TranscriptAdmission{}, room.id, room.memberIDs[actor.userID], "forged", fixtureTranscriptText, 0, 200, "fr", true); err != ErrTranscriptDisabled {
		t.Fatal("worker wrote in browser-only mode", err)
	}
}

func TestBrowserTranscriptOwnAttributionAndSequenceOnly(t *testing.T) {
	_, admin, actor, room := browserTranscriptFixture(t)
	id := startBrowserTranscript(t, actor, room)
	payload := map[string]any{"sessionId": id, fieldGeneration: room.voiceGeneration, "sequence": 1, "text": "<b>Bonjour</b>", "start": 0, "end": 100, "language": "fr", "speakerId": room.memberIDs[admin.userID], "roomId": "another-room", "id": "overwrite"}
	if err := handleBrowserTranscriptPublish(actor, browserEnvelope(t, "transcript.publish", payload)); err != nil {
		t.Fatal(err)
	}
	segment := room.transcript[0]
	if segment.SpeakerID != room.memberIDs[actor.userID] || segment.RoomID != room.id || !strings.HasPrefix(segment.ID, id+"_") || segment.Source != transcriptionModeBrowser || !segment.Final {
		t.Fatal("client controlled attribution or ID", segment)
	}
	if err := handleBrowserTranscriptPublish(actor, browserEnvelope(t, "transcript.publish", payload)); err == nil {
		t.Fatal("replayed segment accepted")
	}
	if err := handleBrowserTranscriptPublish(admin, browserEnvelope(t, "transcript.publish", payload)); err == nil {
		t.Fatal("another member used lease")
	}
	if len(room.transcript) != 1 {
		t.Fatal("rejection mutated transcript")
	}
}

func TestBrowserTranscriptRejectsEpochRevocationBoundsAndSpoofedConnection(t *testing.T) {
	_, admin, actor, room := browserTranscriptFixture(t)
	id := startBrowserTranscript(t, actor, room)
	valid := browserTranscriptPayload{SessionID: id, Generation: room.voiceGeneration, Sequence: 1, Text: fixtureTranscriptText, Start: 0, End: 100, Language: "fr"}
	invalid := []browserTranscriptPayload{valid, valid, valid, valid, valid}
	invalid[0].Text = strings.Repeat("x", TranscriptTextLimit+1)
	invalid[1].End = 20000
	invalid[2].Language = "en"
	invalid[3].Generation++
	invalid[4].Sequence = 3
	for _, payload := range invalid {
		if err := handleBrowserTranscriptPublish(actor, browserEnvelope(t, "transcript.publish", payload)); err == nil {
			t.Fatal("invalid client segment accepted")
		}
	}
	otherSocket := &Client{hub: actor.hub, userID: actor.userID, send: make(chan []byte, 64)}
	if err := handleBrowserTranscriptPublish(otherSocket, browserEnvelope(t, "transcript.publish", valid)); err == nil {
		t.Fatal("other connection reused consent")
	}
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if err := handleBrowserTranscriptPublish(actor, browserEnvelope(t, "transcript.publish", valid)); err == nil {
		t.Fatal("demotion retained consent")
	}
	if len(room.transcript) != 0 {
		t.Fatal("invalid results persisted")
	}
}

func TestBrowserTranscriptStopExpiryPauseAndSpectator(t *testing.T) {
	_, _, actor, room := browserTranscriptFixture(t)
	id := startBrowserTranscript(t, actor, room)
	payload := browserTranscriptPayload{SessionID: id, Generation: room.voiceGeneration, Sequence: 1, Text: fixtureTranscriptText, Start: 0, End: 100, Language: "fr"}
	session := room.browserTranscripts[room.memberIDs[actor.userID]]
	session.seen = time.Now().Add(-20 * time.Second)
	if err := handleBrowserTranscriptPublish(actor, browserEnvelope(t, "transcript.publish", payload)); err == nil {
		t.Fatal("expired lease accepted")
	}
	session.seen = time.Now()
	room.settings.TranscriptionEnabled = false
	if err := handleBrowserTranscriptPublish(actor, browserEnvelope(t, "transcript.publish", payload)); err == nil {
		t.Fatal("paused room accepted captions")
	}
	room.settings.TranscriptionEnabled = true
	if err := handleBrowserTranscriptStop(actor, browserEnvelope(t, "transcript.stop", payload)); err != nil {
		t.Fatal(err)
	}
	if err := handleBrowserTranscriptPublish(actor, browserEnvelope(t, "transcript.publish", payload)); err == nil {
		t.Fatal("stopped lease accepted results")
	}
	if err := room.Demote(actor.userID); err != nil {
		t.Fatal(err)
	}
	if err := handleBrowserTranscriptStart(actor, browserEnvelope(t, "transcript.start", map[string]any{"requestId": "next", fieldGeneration: room.voiceGeneration, "consent": true})); err == nil {
		t.Fatal("spectator opted in")
	}
}
