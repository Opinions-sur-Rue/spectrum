package spectrum

import (
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func TestV2TitleComesOnlyFromMarkdown(t *testing.T) {
	hub := NewHub()
	hub.users["admin"] = NewUser("admin")
	roomID, _, err := hub.NewRoom("admin")
	if err != nil {
		t.Fatal(err)
	}
	client := &Client{hub: hub, userID: "admin", send: make(chan []byte, 10)}
	envelope, err := valueobjects.NewEnvelope("note.create", map[string]any{"title": "Ignored separate title", "markdown": "# Real heading\n\nBody"})
	if err != nil {
		t.Fatal(err)
	}
	if err := handleNoteCreate(client, envelope); err != nil {
		t.Fatal(err)
	}
	board := hub.rooms[roomID].Board()
	note := board.Snapshot().Notes[0]
	if note.Title != "Real heading" {
		t.Fatalf("title = %q", note.Title)
	}
	envelope, err = valueobjects.NewEnvelope("note.update", map[string]any{"noteId": note.ID, "version": note.Version, "title": "Still ignored", "markdown": "# Updated heading"})
	if err != nil {
		t.Fatal(err)
	}
	if err := handleNoteUpdate(client, envelope); err != nil {
		t.Fatal(err)
	}
	updated, _ := board.GetNote(note.ID)
	if updated.Title != "Updated heading" || updated.Markdown != "# Updated heading" {
		t.Fatalf("updated = %+v", updated)
	}
}
