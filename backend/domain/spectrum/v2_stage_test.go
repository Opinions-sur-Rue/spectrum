package spectrum

import (
	"bytes"
	"encoding/json"
	"fmt"
	"testing"

	canvasdomain "Opinions-sur-Rue/spectrum/domain/canvas"
	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func stageFixture(t *testing.T) (*Hub, *Client, *Client, *Room) {
	t.Helper()
	hub := NewHub()
	hub.users["private-admin-signin"] = NewUser("private-admin-signin")
	hub.users["private-guest-signin"] = NewUser("private-guest-signin")
	roomID, _, err := hub.NewRoom("private-admin-signin")
	if err != nil {
		t.Fatal(err)
	}
	if err := hub.JoinSpectator(roomID, "private-guest-signin"); err != nil {
		t.Fatal(err)
	}
	admin := &Client{hub: hub, userID: "private-admin-signin", send: make(chan []byte, 64)}
	guest := &Client{hub: hub, userID: "private-guest-signin", send: make(chan []byte, 64)}
	return hub, admin, guest, hub.rooms[roomID]
}

func stageEnvelope(t *testing.T, op, memberID string) *valueobjects.Envelope {
	t.Helper()
	envelope, err := valueobjects.NewEnvelope(op, map[string]string{fieldMemberID: memberID})
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestV2StageCycleAndPendingNoteVisibility(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	target := room.memberIDs[guest.userID]
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", target)); err != nil {
		t.Fatal(err)
	}
	if role, _ := room.RoleOf(guest.userID); role != RoleParticipant {
		t.Fatalf("role = %s", role)
	}
	create, _ := valueobjects.NewEnvelope("note.create", map[string]string{fieldMarkdown: "# Proposal"})
	if err := handleNoteCreate(guest, create); err != nil {
		t.Fatal(err)
	}
	note := room.Board().Snapshot().Notes[0]
	if note.Moderation != canvasdomain.ModerationPending {
		t.Fatal("participant note must be pending")
	}
	guest.hub.users[guest.userID].SetMicrophoneEnabled(true)
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", target)); err != nil {
		t.Fatal(err)
	}
	if guest.hub.users[guest.userID].MicrophoneEnabled() {
		t.Fatal("demotion retained microphone flag")
	}
	if err := handleCanvasGet(guest, create); err != nil {
		t.Fatal(err)
	}
	var snapshotEvent valueobjects.Envelope
	if err := json.Unmarshal(<-guest.send, &snapshotEvent); err != nil {
		t.Fatal(err)
	}
	var snapshot canvasdomain.Snapshot
	if err := snapshotEvent.DecodePayload(&snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Notes) != 0 {
		t.Fatal("demoted author received pending note")
	}
	if err := handleNoteCreate(guest, create); err != ErrForbidden {
		t.Fatalf("spectator create error = %v", err)
	}
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", target)); err != nil {
		t.Fatal(err)
	}
	if room.memberIDs[guest.userID] != target {
		t.Fatal("stage change replaced public author identity")
	}
}

func TestV2StageRejectsUnauthorizedTargets(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	for _, test := range []struct {
		name    string
		client  *Client
		target  string
		promote bool
	}{
		{"spectator self promotion", guest, room.memberIDs[guest.userID], true},
		{"self demotion", admin, room.memberIDs[admin.userID], false},
		{"unknown public ID", admin, "outside-room", true},
		{"signin ID is not a member selector", admin, guest.userID, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := changeStage(test.client, stageEnvelope(t, "room.promote", test.target), test.promote); err != ErrForbidden {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestV2PublicStateDoesNotExposeSigninIDs(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	note, err := room.Board().CreateNote(admin.userID, canvasdomain.NoteDraft{Title: "Public", Markdown: "# Public"}, canvasdomain.ModerationApproved)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := room.Board().Reveal(note.ID, true); err != nil {
		t.Fatal(err)
	}
	settings := room.Settings()
	settings.NotesVisibleToSpectators = true
	room.SetSettings(settings)
	if err := handleRoomGet(guest, stageEnvelope(t, "room.get", "")); err != nil {
		t.Fatal(err)
	}
	for len(guest.send) > 0 {
		frame := <-guest.send
		if bytes.Contains(frame, []byte(admin.userID)) || bytes.Contains(frame, []byte(guest.userID)) {
			t.Fatalf("signin ID exposed: %s", frame)
		}
	}
	projected := guest.publicNote(room.id, note)
	if projected.AuthorID != room.memberIDs[admin.userID] || projected.AuthorID == "" {
		t.Fatal("note author does not match public roster")
	}
}

func TestStageFillsAllConfiguredSlots(t *testing.T) {
	for attempt := range 50 {
		creator := NewUser("admin")
		room := NewRoom(creator, "room", "")
		settings := room.Settings()
		settings.ParticipantSlots = 6
		room.SetSettings(settings)
		if _, err := room.AddUser(creator); err != nil {
			t.Fatal(err)
		}
		for seat := range 6 {
			user := NewUser(fmt.Sprintf("guest-%d-%d", attempt, seat))
			if err := room.AddSpectator(user); err != nil {
				t.Fatal(err)
			}
			_, err := room.Promote(user.UserID)
			if seat < 5 && err != nil {
				t.Fatalf("slot %d of 6: %v", seat+2, err)
			}
			if seat == 5 && err != ErrRoomFull {
				t.Fatalf("excess promotion error = %v", err)
			}
		}
	}
}
