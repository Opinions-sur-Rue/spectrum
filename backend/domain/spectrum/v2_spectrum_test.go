package spectrum

import (
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func spectrumEnvelope(t *testing.T, op string, payload any) *valueobjects.Envelope {
	t.Helper()
	envelope, err := valueobjects.NewEnvelope(op, payload)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestSpectrumMovementIsRoleDerivedAndSelfOnly(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	move := spectrumEnvelope(t, "spectrum.move", map[string]any{"x": -99999, "y": 99999, fieldMemberID: room.memberIDs[admin.userID]})
	if err := handleSpectrumMove(guest, move); err != ErrForbidden {
		t.Fatalf("spectator move error = %v", err)
	}
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	if err := handleSpectrumMove(guest, move); err != nil {
		t.Fatal(err)
	}
	x, y := spectrumPosition(guest.hub.users[guest.userID])
	if x != 14 || y != 721 {
		t.Fatalf("unclamped position: %v,%v", x, y)
	}
	if guest.hub.users[admin.userID].LastPosition() != PositionNA {
		t.Fatal("participant moved someone else's pellet")
	}
	if err := handleSpectrumMove(guest, spectrumEnvelope(t, "spectrum.move", map[string]int{"x": 50})); err != ErrInvalidPosition {
		t.Fatalf("missing coordinate error = %v", err)
	}
}

func TestSpectrumAudienceFiltersCoordinatesAtSource(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	room.participantsHidden = true
	if len(room.spectrumFor(admin.userID, RoleAdmin).Pellets) != 2 {
		t.Fatal("admin must see all positions")
	}
	participant := room.spectrumFor(guest.userID, RoleParticipant)
	if len(participant.Pellets) != 1 || participant.Pellets[0].MemberID != room.memberIDs[guest.userID] {
		t.Fatal("participant must only see own hidden pellet")
	}
	if len(room.spectrumFor("spectator", RoleSpectator).Pellets) != 0 {
		t.Fatal("hidden positions exposed to audience")
	}
	room.participantsHidden = false
	settings := room.Settings()
	settings.PelletsVisibleToSpectators = false
	room.SetSettings(settings)
	if len(room.spectrumFor("spectator", RoleSpectator).Pellets) != 0 {
		t.Fatal("disabled spectator visibility leaked coordinates")
	}
	if len(room.spectrumFor(guest.userID, RoleParticipant).Pellets) != 2 {
		t.Fatal("spectator toggle affected participants")
	}
}

func TestSpectrumAdminTopicResetAndPartialSettings(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	topic := spectrumEnvelope(t, "spectrum.topic", map[string]string{"topic": "  A discussion  "})
	if err := handleSpectrumTopic(guest, topic); err != ErrForbidden {
		t.Fatalf("spectator topic error = %v", err)
	}
	if err := handleSpectrumTopic(admin, topic); err != nil {
		t.Fatal(err)
	}
	if room.Topic() != "A discussion" {
		t.Fatal("topic not normalized")
	}
	if err := handleSpectrumMove(admin, spectrumEnvelope(t, "spectrum.move", map[string]int{"x": 100, "y": 200})); err != nil {
		t.Fatal(err)
	}
	reset := spectrumEnvelope(t, "spectrum.reset", struct{}{})
	if err := handleSpectrumReset(guest, reset); err != ErrForbidden {
		t.Fatalf("spectator reset error = %v", err)
	}
	if err := handleSpectrumReset(admin, reset); err != nil {
		t.Fatal(err)
	}
	if admin.hub.users[admin.userID].LastPosition() != PositionNA {
		t.Fatal("reset did not clear stored position")
	}
	settings := room.Settings()
	settings.NotesVisibleToSpectators = true
	room.SetSettings(settings)
	if err := handleRoomSettings(admin, spectrumEnvelope(t, "room.settings", map[string]bool{"pelletsHidden": true})); err != nil {
		t.Fatal(err)
	}
	if !room.Settings().NotesVisibleToSpectators || !room.participantsHidden {
		t.Fatal("partial settings reset unrelated values")
	}
}

func TestLegacyTransportCannotBypassStagePermissions(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	for _, procedure := range []string{"myposition", "myvoicechatid", "unmutedmymicrophone", "claim", "resetpositions", "makeadmin"} {
		if err := guest.EvaluateRPC(&valueobjects.MessageContent{Procedure: procedure, Arguments: []string{"100,200", "forged"}}); err != ErrForbidden {
			t.Fatalf("spectator %s error = %v", procedure, err)
		}
	}
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	for _, procedure := range []string{"claim", "resetpositions", "makeadmin"} {
		if err := guest.EvaluateRPC(&valueobjects.MessageContent{Procedure: procedure, Arguments: []string{guest.hub.users[guest.userID].Color}}); err != ErrForbidden {
			t.Fatalf("participant %s error = %v", procedure, err)
		}
	}
	if role, _ := room.RoleOf(guest.userID); role != RoleParticipant {
		t.Fatal("legacy command escalated role")
	}
}

func TestLegacyInvalidCoordinatesNeverReachSpectrumSnapshots(t *testing.T) {
	user := NewUser("test")
	user.SetColor(generalColors[0])
	for _, position := range []string{"NaN,0", "+Inf,0", "N,A", "0", ""} {
		user.SetLastPosition(position)
		x, y := spectrumPosition(user)
		if x != 415 || y != 555 || !finitePosition(x, y) {
			t.Fatalf("%q produced %v,%v", position, x, y)
		}
	}
	user.SetLastPosition("-100,9999")
	x, y := spectrumPosition(user)
	if x != 14 || y != 721 {
		t.Fatalf("legacy out-of-bounds position: %v,%v", x, y)
	}
}
