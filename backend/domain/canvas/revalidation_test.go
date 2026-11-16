package canvas

import "testing"

func TestApprovedContentEditRequiresNewReview(t *testing.T) {
	board := New()
	note, err := board.CreateNote("author", NoteDraft{Title: "Original", Markdown: "# Original"}, ModerationApproved)
	if err != nil {
		t.Fatal(err)
	}
	note, err = board.Reveal(note.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	color := "blue"
	note, err = board.UpdateNote(note.ID, note.Version, NotePatch{Color: &color})
	if err != nil || note.Moderation != ModerationApproved || !note.Visible {
		t.Fatal("color reset review", err)
	}
	same := note.Markdown
	note, err = board.UpdateNote(note.ID, note.Version, NotePatch{Markdown: &same})
	if err != nil || note.Moderation != ModerationApproved || !note.Visible {
		t.Fatal("no-op reset review", err)
	}
	text := "# Changed"
	title := "Changed"
	note, err = board.UpdateNote(note.ID, note.Version, NotePatch{Title: &title, Markdown: &text})
	if err != nil || note.Moderation != ModerationPending || note.Visible {
		t.Fatal("changed content remained approved/visible", err)
	}
	if _, err := board.Reveal(note.ID, true); err != ErrNoteNotApproved {
		t.Fatal("unreviewed content was revealable", err)
	}
	note, err = board.Moderate(note.ID, ModerationApproved)
	if err != nil || note.Visible {
		t.Fatal("approval unexpectedly auto-revealed content", err)
	}
}
