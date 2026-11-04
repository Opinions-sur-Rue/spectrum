package spectrum

import (
	"bytes"
	"encoding/json"
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func TestLiveMovementDeltaRespectsAudience(t *testing.T) {
	hub, admin, actor, room := stageFixture(t)
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"observer", "participant"} {
		hub.users[id] = NewUser(id)
		if err := hub.JoinSpectator(room.id, id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := room.Promote("participant"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name               string
		hidden, spectators bool
		recipients         int
	}{
		{"visible", false, true, 4}, {"hidden", true, true, 2}, {"stage only", false, false, 3},
	} {
		t.Run(test.name, func(t *testing.T) {
			room.participantsHidden = test.hidden
			settings := room.Settings()
			settings.PelletsVisibleToSpectators = test.spectators
			room.SetSettings(settings)
			for len(hub.messages) > 0 {
				<-hub.messages
			}
			before := hub.users[actor.userID].positionVersion
			if err := handleSpectrumMove(actor, spectrumEnvelope(t, "spectrum.move", map[string]int{"x": 120, "y": 240})); err != nil {
				t.Fatal(err)
			}
			if len(hub.messages) != test.recipients {
				t.Fatalf("recipients = %d, want %d", len(hub.messages), test.recipients)
			}
			for len(hub.messages) > 0 {
				message := <-hub.messages
				delta := movementDelta(t, message.Content(), actor.userID)
				if delta.MemberID != room.memberIDs[actor.userID] || delta.Revision != room.spectrumRevision || delta.Version <= before || delta.X != 120 || delta.Y != 240 {
					t.Fatalf("invalid delta: %+v", delta)
				}
				if test.hidden && message.Recipient() != actor.userID && message.Recipient() != admin.userID {
					t.Fatal("hidden movement leaked")
				}
			}
		})
	}
}

func movementDelta(t *testing.T, raw []byte, privateID string) spectrumMovementPayload {
	t.Helper()
	if bytes.Contains(raw, []byte(privateID)) {
		t.Fatal("movement leaked signin ID")
	}
	var envelope valueobjects.Envelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Op != "spectrum.moved" {
		t.Fatalf("unexpected op %s", envelope.Op)
	}
	var delta spectrumMovementPayload
	if err := envelope.DecodePayload(&delta); err != nil {
		t.Fatal(err)
	}
	return delta
}

func TestQueuedMovementCannotCrossVisibilityRevision(t *testing.T) {
	hub, admin, _, room := stageFixture(t)
	old := spectrumMovementPayload{Revision: room.spectrumRevision, MemberID: room.memberIDs[admin.userID], X: 100, Y: 200, Version: 1}
	room.SetSettings(room.Settings())
	admin.broadcastSpectrumMovement(room.id, admin.userID, room, old)
	if len(hub.messages) != 0 {
		t.Fatal("stale movement sent after structural change")
	}
}
