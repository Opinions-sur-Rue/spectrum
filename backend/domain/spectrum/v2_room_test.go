package spectrum

import (
	"encoding/json"
	"testing"

	canvasdomain "Opinions-sur-Rue/spectrum/domain/canvas"
	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func TestV2SpectatorJoinRetainsRoomID(t *testing.T) {
	hub := NewHub()
	admin := NewUser(fixtureAdminID)
	guest := NewUser(fixtureGuestID)
	hub.users[admin.UserID] = admin
	hub.users[guest.UserID] = guest
	roomID, _, err := hub.NewRoom(admin.UserID)
	if err != nil {
		t.Fatal(err)
	}
	client := &Client{hub: hub, userID: guest.UserID, send: make(chan []byte, 10)}
	envelope, err := valueobjects.NewEnvelope("room.join", roomJoinPayload{RoomID: roomID})
	if err != nil {
		t.Fatal(err)
	}
	if err := handleRoomJoin(client, envelope); err != nil {
		t.Fatal(err)
	}
	if guest.Room() != roomID {
		t.Fatalf("guest room = %q, want %q", guest.Room(), roomID)
	}
	if hub.rooms[roomID].RoomID() != roomID {
		t.Fatal("room constructor did not retain ID")
	}
	_, _, role, _, _, err := client.v2RoomContext()
	if err != nil || role != RoleSpectator {
		t.Fatalf("role = %s, err = %v", role, err)
	}
}

func TestV2SettingsAdminOnlyAndRoomScoped(t *testing.T) {
	hub := NewHub()
	for _, id := range []string{fixtureAdminID, fixtureGuestID, fixtureOtherID} {
		hub.users[id] = NewUser(id)
	}
	roomID, _, err := hub.NewRoom(fixtureAdminID)
	if err != nil {
		t.Fatal(err)
	}
	otherID, _, err := hub.NewRoom(fixtureOtherID)
	if err != nil {
		t.Fatal(err)
	}
	if err := hub.JoinSpectator(roomID, fixtureGuestID); err != nil {
		t.Fatal(err)
	}
	envelope, err := valueobjects.NewEnvelope("room.settings", map[string]bool{"notesVisibleToSpectators": true})
	if err != nil {
		t.Fatal(err)
	}
	guest := &Client{hub: hub, userID: fixtureGuestID, send: make(chan []byte, 10)}
	if err := handleRoomSettings(guest, envelope); err != ErrForbidden {
		t.Fatalf("spectator settings error = %v", err)
	}
	admin := &Client{hub: hub, userID: fixtureAdminID, send: make(chan []byte, 10)}
	if err := handleRoomSettings(admin, envelope); err != nil {
		t.Fatal(err)
	}
	if !hub.rooms[roomID].Settings().NotesVisibleToSpectators {
		t.Fatal("setting not applied")
	}
	if hub.rooms[otherID].Settings().NotesVisibleToSpectators {
		t.Fatal("setting leaked into another room")
	}
}

func TestV2HideInvalidatesFormerAudience(t *testing.T) {
	hub := NewHub()
	hub.users[fixtureAdminID] = NewUser(fixtureAdminID)
	hub.users[fixtureGuestID] = NewUser(fixtureGuestID)
	roomID, _, err := hub.NewRoom(fixtureAdminID)
	if err != nil {
		t.Fatal(err)
	}
	if err := hub.JoinSpectator(roomID, fixtureGuestID); err != nil {
		t.Fatal(err)
	}
	room := hub.rooms[roomID]
	settings := room.Settings()
	settings.NotesVisibleToSpectators = true
	room.SetSettings(settings)
	board := room.Board()
	first := createVisibleNote(t, board, "First")
	second := createVisibleNote(t, board, "Second")
	if _, err := board.CreateEdge(first.ID, second.ID, canvasdomain.RelationSupports, ""); err != nil {
		t.Fatal(err)
	}
	admin := &Client{hub: hub, userID: fixtureAdminID, send: make(chan []byte, 10)}
	envelope, err := valueobjects.NewEnvelope("note.reveal", noteRevealPayload{NoteID: first.ID, Visible: false})
	if err != nil {
		t.Fatal(err)
	}
	if err := handleNoteReveal(admin, envelope); err != nil {
		t.Fatal(err)
	}
	invalidated := false
	for len(hub.messages) > 0 {
		message := <-hub.messages
		var event valueobjects.Envelope
		if err := json.Unmarshal(message.Content(), &event); err != nil {
			t.Fatal(err)
		}
		if message.Recipient() == fixtureGuestID && event.Op == "canvas.invalidate" {
			invalidated = true
		}
		if message.Recipient() == fixtureGuestID && event.Op == "note.revealed" {
			t.Fatal("hidden content sent to spectator")
		}
	}
	if !invalidated {
		t.Fatal("former audience did not receive invalidation")
	}
	guest := &Client{hub: hub, userID: fixtureGuestID, send: make(chan []byte, 10)}
	if err := handleCanvasGet(guest, envelope); err != nil {
		t.Fatal(err)
	}
	var event valueobjects.Envelope
	if err := json.Unmarshal(<-guest.send, &event); err != nil {
		t.Fatal(err)
	}
	var snapshot canvasdomain.Snapshot
	if err := event.DecodePayload(&snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Notes) != 1 || snapshot.Notes[0].ID != second.ID || len(snapshot.Edges) != 0 {
		t.Fatalf("incorrect filtered snapshot: %+v", snapshot)
	}
}

func createVisibleNote(t *testing.T, board *canvasdomain.Canvas, title string) canvasdomain.Note {
	t.Helper()
	note, err := board.CreateNote(fixtureAdminID, canvasdomain.NoteDraft{Title: title}, canvasdomain.ModerationApproved)
	if err != nil {
		t.Fatal(err)
	}
	note, err = board.Reveal(note.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	return note
}
