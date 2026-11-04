package canvas

import (
	"math"
	"testing"
)

func TestResizePreservesContentVersionAndPosition(t *testing.T) {
	board := New()
	note := mustCreate(t, board, "Resize")
	resized, err := board.ResizeNote(note.ID, 580, 450)
	if err != nil {
		t.Fatal(err)
	}
	if resized.Width != 580 || resized.Height != 450 || resized.Version != note.Version || resized.X != note.X || resized.Y != note.Y {
		t.Fatalf("unexpected resize: %+v", resized)
	}
	text := "Still editing"
	if _, err := board.UpdateNote(note.ID, note.Version, NotePatch{Markdown: &text}); err != nil {
		t.Fatal("resize conflicted with text draft", err)
	}
}

func TestResizeLimitsAndPin(t *testing.T) {
	board := New()
	note := mustCreate(t, board, "Limits")
	for _, size := range [][2]float64{{1, 1}, {9999, 9999}} {
		resized, err := board.ResizeNote(note.ID, size[0], size[1])
		if err != nil {
			t.Fatal(err)
		}
		if resized.Width < MinNoteWidth || resized.Width > MaxNoteWidth || resized.Height < MinNoteHeight || resized.Height > MaxNoteHeight {
			t.Fatal("unbounded size")
		}
	}
	for _, size := range [][2]float64{{0, 400}, {-1, 400}, {math.NaN(), 400}, {400, math.Inf(1)}} {
		if _, err := board.ResizeNote(note.ID, size[0], size[1]); err != ErrInvalidNoteSize {
			t.Fatalf("invalid size accepted: %v", err)
		}
	}
	if _, err := board.PinNote(note.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := board.ResizeNote(note.ID, 500, 500); err != ErrNotePinned {
		t.Fatalf("pinned resize: %v", err)
	}
}

func TestResizeStaysInsideWorldWithoutMovingOrigin(t *testing.T) {
	board := New()
	note := mustCreate(t, board, "Edge")
	note, _ = board.MoveNote(note.ID, 99999, 99999)
	resized, err := board.ResizeNote(note.ID, MaxNoteWidth, MaxNoteHeight)
	if err != nil {
		t.Fatal(err)
	}
	if resized.X != note.X || resized.Y != note.Y || resized.X+resized.Width > WorldWidth/2 || resized.Y+resized.Height > WorldHeight/2 {
		t.Fatal("resize crossed world bounds or moved origin")
	}
}
