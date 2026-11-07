package spectrum

import (
	"encoding/json"
	"fmt"
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func transcriptEnvelope(t *testing.T, after uint64, limit int) *valueobjects.Envelope {
	t.Helper()
	envelope, err := valueobjects.NewEnvelope("transcript.get", map[string]any{"after": after, "limit": limit})
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func readTranscriptSnapshot(t *testing.T, client *Client, envelope *valueobjects.Envelope) transcriptSnapshot {
	t.Helper()
	if err := handleTranscriptGet(client, envelope); err != nil {
		t.Fatal(err)
	}
	var event valueobjects.Envelope
	if err := json.Unmarshal(<-client.send, &event); err != nil {
		t.Fatal(err)
	}
	var snapshot transcriptSnapshot
	if err := event.DecodePayload(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestTranscriptIsVisibleToSpectatorsAndOnlyAcceptsStageSpeakers(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	memberID := room.memberIDs[guest.userID]

	// Spectators have no microphone, so they cannot be a speaker.
	if _, err := hub.AppendTranscript(room.id, memberID, "", "Bonjour", 0, 900, "fr", true); err != ErrTranscriptSpeaker {
		t.Fatalf("spectator transcript accepted: %v", err)
	}
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", memberID)); err != nil {
		t.Fatal(err)
	}
	if _, err := hub.AppendTranscript(room.id, memberID, "utt-1", "Bonjour tout le monde", 0, 1200, "fr", true); err != nil {
		t.Fatal(err)
	}

	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", memberID)); err != nil {
		t.Fatal(err)
	}
	// Demoted speakers still see the shared transcript as spectators.
	snapshot := readTranscriptSnapshot(t, guest, transcriptEnvelope(t, 0, 10))
	if !snapshot.Enabled || len(snapshot.Segments) != 1 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	segment := snapshot.Segments[0]
	if segment.SpeakerID != memberID || segment.Text != "Bonjour tout le monde" || segment.Language != "fr" || !segment.Final {
		t.Fatalf("segment = %+v", segment)
	}
	if segment.SpeakerName == "" || segment.SpeakerName == "private-guest-signin" {
		t.Fatalf("speaker name leaked a private identity: %q", segment.SpeakerName)
	}
}

func TestTranscriptCannotOverwriteAnotherSpeakerOrRegressFinal(t *testing.T) {
	_, _, guest, room := stageFixture(t)
	room.settings.TranscriptionEnabled = true
	segment := transcriptSegment{ID: "utterance", SpeakerID: room.memberIDs[guest.userID], Text: "Final", Final: true}
	if _, _, err := room.appendTranscript(segment); err != nil {
		t.Fatal(err)
	}
	segment.SpeakerID = "m_other"
	if _, _, err := room.appendTranscript(segment); err != ErrTranscriptContent {
		t.Fatal("another speaker overwrote utterance")
	}
	segment.SpeakerID = room.memberIDs[guest.userID]
	segment.Final = false
	if _, _, err := room.appendTranscript(segment); err != ErrTranscriptContent {
		t.Fatal("final utterance regressed to partial")
	}
}

func TestTranscriptPartialsReplaceAndSnapshotsPageBySequence(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	memberID := room.memberIDs[guest.userID]
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", memberID)); err != nil {
		t.Fatal(err)
	}
	first, err := hub.AppendTranscript(room.id, memberID, "utt-1", "Bon", 0, 200, "fr", false)
	if err != nil {
		t.Fatal(err)
	}
	second, err := hub.AppendTranscript(room.id, memberID, "utt-1", "Bonjour", 0, 500, "fr", true)
	if err != nil {
		t.Fatal(err)
	}
	if first.Sequence >= second.Sequence || second.Text != "Bonjour" || !second.Final {
		t.Fatalf("partial did not replace in place: %+v then %+v", first, second)
	}
	third, err := hub.AppendTranscript(room.id, memberID, "utt-2", "Ensuite", 500, 900, "fr", true)
	if err != nil {
		t.Fatal(err)
	}
	page := readTranscriptSnapshot(t, guest, transcriptEnvelope(t, second.Sequence, 10))
	if len(page.Segments) != 1 || page.Segments[0].ID != "utt-2" || page.Sequence != third.Sequence {
		t.Fatalf("after page = %+v", page)
	}
	limited := readTranscriptSnapshot(t, guest, transcriptEnvelope(t, 0, 1))
	if len(limited.Segments) != 1 || limited.Segments[0].ID != "utt-2" {
		t.Fatalf("limited page = %+v", limited)
	}
}

func TestTranscriptIsRejectedWhenDisabled(t *testing.T) {
	hub, _, guest, room := stageFixture(t)
	memberID := room.memberIDs[guest.userID]
	if err := handleRoomPromote(&Client{hub: hub, userID: "private-admin-signin", send: make(chan []byte, 8)}, stageEnvelope(t, "room.promote", memberID)); err != nil {
		t.Fatal(err)
	}
	settings := room.Settings()
	settings.TranscriptionEnabled = false
	room.SetSettings(settings)
	if _, err := hub.AppendTranscript(room.id, memberID, "", "Bonjour", 0, 100, "fr", true); err != ErrTranscriptDisabled {
		t.Fatalf("disabled transcript accepted: %v", err)
	}
}

func TestTranscriptRingDropsOldestSegments(t *testing.T) {
	_, _, guest, room := stageFixture(t)
	room.settings.TranscriptionEnabled = true
	for index := 0; index < DefaultTranscriptSegments+1; index++ {
		if _, _, err := room.appendTranscript(transcriptSegment{
			RoomID: room.id, ID: fmt.Sprintf("utt-%d", index), SpeakerID: room.memberIDs[guest.userID], SpeakerName: "Guest",
			Text: "segment", Start: int64(index), End: int64(index + 1), Language: "fr", Final: true,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if len(room.transcript) != DefaultTranscriptSegments {
		t.Fatalf("ring length = %d, want %d", len(room.transcript), DefaultTranscriptSegments)
	}
	if room.transcript[0].Start != 1 || room.transcriptSequence != DefaultTranscriptSegments+1 {
		t.Fatal("oldest segment was not dropped")
	}
}

func TestTranscriptValidatesContent(t *testing.T) {
	_, _, guest, room := stageFixture(t)
	room.settings.TranscriptionEnabled = true
	for _, segment := range []transcriptSegment{
		{RoomID: room.id, SpeakerID: room.memberIDs[guest.userID], Text: "   "},
		{RoomID: room.id, SpeakerID: room.memberIDs[guest.userID], Text: "ok", Start: 10, End: 5},
		{RoomID: room.id, SpeakerID: room.memberIDs[guest.userID], Text: "ok", Language: "de"},
	} {
		if _, _, err := room.appendTranscript(segment); err != ErrTranscriptContent {
			t.Fatalf("invalid segment accepted: %+v", segment)
		}
	}
}
