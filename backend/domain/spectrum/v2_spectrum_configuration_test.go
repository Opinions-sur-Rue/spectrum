package spectrum

import (
	"fmt"
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func TestSpectrumConfigurationIsAdminOnlyAndPreservesRoomState(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	if err := handleSpectrumMove(guest, spectrumEnvelope(t, "spectrum.move", map[string]int{"x": 120, "y": 250})); err != nil {
		t.Fatal(err)
	}
	room.SetTopic("Keep this topic")
	position := hub.users[guest.userID].LastPosition()
	for _, count := range []int{3, 5, 7, 9} {
		envelope := spectrumEnvelope(t, "spectrum.configure", map[string]any{"sliceCount": count, "showNeutralCircle": false})
		before := room.spectrumRevision
		if err := handleSpectrumConfigure(guest, envelope); err != ErrForbidden {
			t.Fatalf("participant configuration accepted: %v", err)
		}
		if room.spectrumRevision != before {
			t.Fatal("forbidden change mutated spectrum")
		}
		if err := handleSpectrumConfigure(admin, envelope); err != nil {
			t.Fatal(err)
		}
		for _, role := range []Role{RoleAdmin, RoleParticipant, RoleSpectator} {
			state := room.spectrumFor(guest.userID, role)
			if state.SliceCount != count || state.ShowNeutralCircle || state.Revision <= before {
				t.Fatalf("configuration not shared: %+v", state)
			}
		}
		if room.Topic() != "Keep this topic" || hub.users[guest.userID].LastPosition() != position {
			t.Fatal("configuration reset topic or positions")
		}
	}
	if err := handleSpectrumConfigure(admin, spectrumEnvelope(t, "spectrum.configure", map[string]bool{"showNeutralCircle": true})); err != nil {
		t.Fatal(err)
	}
	if room.SliceCount() != 9 || !room.ShowNeutralCircle() {
		t.Fatal("partial toggle reset number of slices")
	}
}

func TestSpectrumConfigurationRejectsInvalidCountsWithoutMutation(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	for _, count := range []int{-1, 0, 1, 2, 4, 6, 8, 10, 999} {
		before := room.spectrumRevision
		err := handleSpectrumConfigure(admin, spectrumEnvelope(t, "spectrum.configure", map[string]int{"sliceCount": count}))
		if err != ErrInvalidSpectrumConfiguration || room.SliceCount() != 7 || room.spectrumRevision != before {
			t.Fatalf("invalid count %d accepted: %v", count, err)
		}
	}
	if err := handleSpectrumConfigure(guest, spectrumEnvelope(t, "spectrum.configure", map[string]int{"sliceCount": 3})); err != ErrForbidden {
		t.Fatal("spectator configured spectrum")
	}
	for _, payload := range []any{map[string]float64{"sliceCount": 3.5}, map[string]string{"sliceCount": "3"}, map[string]string{"showNeutralCircle": "false"}, struct{}{}} {
		if err := handleSpectrumConfigure(admin, spectrumEnvelope(t, "spectrum.configure", payload)); err == nil {
			t.Fatalf("invalid payload accepted: %+v", payload)
		}
	}
}

func TestRoomCreateHonorsSpectrumConfiguration(t *testing.T) {
	for _, count := range []int{3, 5, 7, 9} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			hub := NewHub()
			hub.users["creator"] = NewUser("creator")
			client := &Client{hub: hub, userID: "creator", send: make(chan []byte, 16)}
			envelope := spectrumEnvelope(t, "room.create", map[string]any{"sliceCount": count, "showNeutralCircle": false, "topic": "  Initial discussion  "})
			if err := handleRoomCreate(client, envelope); err != nil {
				t.Fatal(err)
			}
			room := hub.GetRoom(hub.users["creator"].Room())
			if room.SliceCount() != count || room.ShowNeutralCircle() || room.Topic() != "Initial discussion" {
				t.Fatal("creation ignored spectrum options")
			}
		})
	}
}

func TestInvalidCreationDoesNotAllocateRoom(t *testing.T) {
	hub := NewHub()
	hub.users["creator"] = NewUser("creator")
	client := &Client{hub: hub, userID: "creator", send: make(chan []byte, 16)}
	if err := handleRoomCreate(client, spectrumEnvelope(t, "room.create", map[string]int{"sliceCount": 4})); err != ErrInvalidSpectrumConfiguration {
		t.Fatal("invalid room created")
	}
	if hub.CountTotalRooms() != 0 || hub.users["creator"].IsInRoom() {
		t.Fatal("invalid creation partially allocated state")
	}
	envelope, _ := valueobjects.NewEnvelope("room.create", struct{}{})
	if err := handleRoomCreate(client, envelope); err != nil {
		t.Fatal(err)
	}
	room := hub.GetRoom(hub.users["creator"].Room())
	if room.SliceCount() != 7 || !room.ShowNeutralCircle() {
		t.Fatal("default configuration no longer matches v1")
	}
}
