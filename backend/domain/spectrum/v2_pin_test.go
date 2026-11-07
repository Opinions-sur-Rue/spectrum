package spectrum

import (
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func TestV2PinAuthorizationAndMoveProtection(t *testing.T) {
	hub := NewHub()
	hub.users[fixtureAdminID] = NewUser(fixtureAdminID)
	hub.users["spectator"] = NewUser("spectator")
	roomID, _, err := hub.NewRoom(fixtureAdminID)
	if err != nil {
		t.Fatal(err)
	}
	if err := hub.JoinSpectator(roomID, "spectator"); err != nil {
		t.Fatal(err)
	}
	board := hub.rooms[roomID].Board()
	note := createVisibleNote(t, board, "Pinned test")
	envelope, err := valueobjects.NewEnvelope("note.pin", notePinPayload{NoteID: note.ID, Pinned: true})
	if err != nil {
		t.Fatal(err)
	}
	spectator := &Client{hub: hub, userID: "spectator", send: make(chan []byte, 10)}
	if err := handleNotePin(spectator, envelope); err != ErrForbidden {
		t.Fatalf("spectator error = %v", err)
	}
	admin := &Client{hub: hub, userID: fixtureAdminID, send: make(chan []byte, 10)}
	if err := handleNotePin(admin, envelope); err != nil {
		t.Fatal(err)
	}
	move, err := valueobjects.NewEnvelope("note.move", noteMovePayload{NoteID: note.ID, X: 100, Y: 100})
	if err != nil {
		t.Fatal(err)
	}
	if err := handleNoteMove(admin, move); err == nil {
		t.Fatal("admin moved a pinned note")
	}
	unpin, err := valueobjects.NewEnvelope("note.pin", notePinPayload{NoteID: note.ID, Pinned: false})
	if err != nil {
		t.Fatal(err)
	}
	if err := handleNotePin(spectator, unpin); err != ErrForbidden {
		t.Fatalf("spectator unpin error = %v", err)
	}
	if err := handleNotePin(admin, unpin); err != nil {
		t.Fatal(err)
	}
	if err := handleNoteMove(admin, move); err != nil {
		t.Fatal(err)
	}
}
