package canvas

import "testing"

func TestPinPreventsMovementButNotEditing(t *testing.T) {
	board := New()
	note := mustCreate(t, board, "Original")
	pinned, err := board.PinNote(note.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if !pinned.Pinned || pinned.Version != note.Version {
		t.Fatal("pin must not change content version")
	}
	revision := board.Revision()
	if _, err := board.MoveNote(note.ID, 500, 500); err != ErrNotePinned {
		t.Fatalf("move error = %v", err)
	}
	stored, _ := board.GetNote(note.ID)
	if stored.X != note.X || stored.Y != note.Y || board.Revision() != revision {
		t.Fatal("rejected move changed state")
	}
	markdown := "# Still editable"
	if _, err := board.UpdateNote(note.ID, note.Version, NotePatch{Markdown: &markdown}); err != nil {
		t.Fatal(err)
	}
	if _, err := board.PinNote(note.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := board.MoveNote(note.ID, 500, 500); err != nil {
		t.Fatal(err)
	}
}

func TestPinMissingNote(t *testing.T) {
	if _, err := New().PinNote("missing", true); err != ErrNoteNotFound {
		t.Fatalf("error = %v", err)
	}
}
