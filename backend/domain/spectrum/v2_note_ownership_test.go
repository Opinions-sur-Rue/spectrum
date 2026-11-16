package spectrum

import (
	"testing"

	canvasdomain "Opinions-sur-Rue/spectrum/domain/canvas"
	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func TestNoteOwnershipSeparatesContentFromModeration(t *testing.T) {
	hub, admin, author, room := stageFixture(t)
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[author.userID])); err != nil {
		t.Fatal(err)
	}
	board := room.Board()
	note, err := board.CreateNote(author.userID, canvasdomain.NoteDraft{Title: "First", Markdown: "# First"}, canvasdomain.ModerationApproved)
	if err != nil {
		t.Fatal(err)
	}
	note, err = board.Reveal(note.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	text := "# Changed"
	update, _ := valueobjects.NewEnvelope("note.update", noteUpdatePayload{NoteID: note.ID, Version: note.Version, Markdown: &text})
	if err := handleNoteUpdate(admin, update); err != ErrForbidden {
		t.Fatal("admin edited another author's content", err)
	}
	move, _ := valueobjects.NewEnvelope("note.move", noteMovePayload{NoteID: note.ID, X: 1800, Y: 0})
	if err := handleNoteMove(admin, move); err != nil {
		t.Fatal("admin cannot arrange note", err)
	}
	if err := handleNoteUpdate(author, update); err != nil {
		t.Fatal("author cannot revise approved note", err)
	}
	changed, _ := board.GetNote(note.ID)
	if changed.Moderation != canvasdomain.ModerationPending || changed.Visible || changed.Markdown != text {
		t.Fatal("content not returned to review")
	}
	if canSeeNote("other", RoleParticipant, room.Settings(), changed) {
		t.Fatal("unreviewed revision leaked to participant")
	}
	hub.users[author.userID].Nickname = "Visible author"
	public := admin.publicNote(room.id, changed)
	if public.AuthorID != room.memberIDs[author.userID] || public.AuthorID == author.userID || public.AuthorName != "Visible author" {
		t.Fatal("public attribution missing or leaked signin ID")
	}
}
