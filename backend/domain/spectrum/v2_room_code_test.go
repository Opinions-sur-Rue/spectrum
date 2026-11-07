package spectrum

import (
	"strings"
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func roomCode(roomID string) string {
	return strings.TrimPrefix(roomID, "OSR-")
}

func TestV2RoomCodesResistGuessing(t *testing.T) {
	hub := NewHub()
	hub.users[fixtureAdminID] = NewUser(fixtureAdminID)
	client := &Client{hub: hub, userID: fixtureAdminID, send: make(chan []byte, 10)}
	envelope, err := valueobjects.NewEnvelope("room.create", struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	if err := handleRoomCreate(client, envelope); err != nil {
		t.Fatal(err)
	}
	_, roomID, _, _, _, err := client.v2RoomContext()
	if err != nil {
		t.Fatal(err)
	}
	if got := len(roomCode(roomID)); got != 12 {
		t.Fatalf("v2 room code length = %d, want 12", got)
	}
}

func TestLegacyRoomCodesKeepTheirLength(t *testing.T) {
	hub := NewHub()
	hub.users[fixtureAdminID] = NewUser(fixtureAdminID)
	roomID, _, err := hub.NewRoom(fixtureAdminID)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(roomCode(roomID)); got != 4 {
		t.Fatalf("legacy room code length = %d, want 4", got)
	}
}

func TestRoomCodeLengthIsBounded(t *testing.T) {
	hub := NewHub()
	hub.users[fixtureAdminID] = NewUser(fixtureAdminID)
	for _, length := range []int{0, 3, 65} {
		if _, _, err := hub.NewRoomWithCode(fixtureAdminID, length); err == nil {
			t.Fatalf("accepted room code length %d", length)
		}
	}
}
