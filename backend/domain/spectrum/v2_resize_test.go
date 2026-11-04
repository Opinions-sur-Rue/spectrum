package spectrum

import "testing"

func TestResizeUsesEditPermissions(t *testing.T) {
	_, admin, spectator, room := stageFixture(t)
	note := createVisibleNote(t, room.Board(), "Resize")
	request := spectrumEnvelope(t, "note.resize", noteResizePayload{NoteID: note.ID, Width: 500, Height: 450})
	if err := handleNoteResize(spectator, request); err != ErrForbidden {
		t.Fatalf("spectator resize error: %v", err)
	}
	if err := handleNoteResize(admin, request); err != nil {
		t.Fatal(err)
	}
	stored, _ := room.Board().GetNote(note.ID)
	if stored.Width != 500 || stored.Height != 450 {
		t.Fatal("resize not retained")
	}
}
