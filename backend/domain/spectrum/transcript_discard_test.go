package spectrum

import "testing"

func TestTranscriptDiscardIsVersionedAndCannotDeleteFinals(t *testing.T) {
	_, _, guest, room := stageFixture(t)
	room.settings.TranscriptionEnabled = true
	partial := transcriptSegment{ID: "utterance", SpeakerID: room.memberIDs[guest.userID], Text: "Draft", Start: 100, End: 900, Language: "fr"}
	first, _, err := room.appendTranscript(partial)
	if err != nil {
		t.Fatal(err)
	}
	discard := partial
	discard.Text, discard.Discarded, discard.Final = "", true, true
	removed, _, err := room.appendTranscript(discard)
	if err != nil || removed.Sequence <= first.Sequence || removed.Text != "" || !removed.Discarded {
		t.Fatalf("invalid tombstone: %+v %v", removed, err)
	}
	partial.Final = true
	if _, _, err := room.appendTranscript(partial); err != ErrTranscriptContent {
		t.Fatal("late text revived discarded draft")
	}
	partial.ID = "other"
	if _, _, err := room.appendTranscript(partial); err != nil {
		t.Fatal(err)
	}
	discard.ID = "other"
	if _, _, err := room.appendTranscript(discard); err != ErrTranscriptContent {
		t.Fatal("discard removed an established final quote")
	}
	discard.ID = "unknown"
	if _, _, err := room.appendTranscript(discard); err != ErrTranscriptContent {
		t.Fatal("unknown utterance was discarded")
	}
}
