package spectrum

import (
	"errors"
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func stagePromote(t *testing.T, admin, guest *Client, room *Room) string {
	t.Helper()
	memberID := room.memberIDs[guest.userID]
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", memberID)); err != nil {
		t.Fatal(err)
	}
	return memberID
}

func TestSessionAppointRejectsUntrustedSelectors(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	memberID := stagePromote(t, admin, guest, room)
	if err := handleRoomAppoint(admin, stageEnvelope(t, "room.appoint", room.memberIDs[admin.userID])); err == nil {
		t.Fatal("appointed the caller")
	}
	if err := handleRoomAppoint(admin, stageEnvelope(t, "room.appoint", fixtureOutsideMemberID)); err == nil {
		t.Fatal("appointed a member of another room")
	}
	for _, id := range []string{admin.userID, memberID, fixtureOutsideMemberID} {
		if err := handleRoomAppoint(guest, stageEnvelope(t, "room.appoint", id)); err == nil {
			t.Fatal("participant appointed authority")
		}
	}
	if len(room.admins) != 1 || !room.IsAdmin(admin.userID) {
		t.Fatalf("rejected appointments mutated authority: %v", room.admins)
	}
	abdicate, _ := valueobjects.NewEnvelope("room.abdicate", struct{}{})
	if err := handleRoomAbdicate(guest, abdicate); err == nil {
		t.Fatal("participant gave up authority it never had")
	}
	if err := handleRoomAbdicate(admin, abdicate); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("last admin abdicated: %v", err)
	}
	if !room.IsAdmin(admin.userID) {
		t.Fatal("rejected abdication removed the only admin")
	}
}

func TestSessionAppointIsAdditive(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	memberID := stagePromote(t, admin, guest, room)
	target := stageEnvelope(t, "room.appoint", memberID)
	stop, _ := valueobjects.NewEnvelope("room.stop", struct{}{})
	if err := handleRoomStop(guest, stop); err == nil {
		t.Fatal("participant stopped the room")
	}
	if err := handleRoomAppoint(admin, target); err != nil {
		t.Fatal(err)
	}
	if !room.IsAdmin(admin.userID) || !room.IsAdmin(guest.userID) || len(room.admins) != 2 {
		t.Fatalf("appointment was not additive: %v", room.admins)
	}
	if err := handleRoomAppoint(admin, target); err == nil {
		t.Fatal("appointed the same member twice")
	}
	// Co-administration is real administration.
	if role, _ := room.RoleOf(guest.userID); role != RoleAdmin {
		t.Fatalf("co-admin role = %s", role)
	}
	if err := handleRoomAppoint(admin, stageEnvelope(t, "room.appoint", room.memberIDs[guest.userID])); err == nil {
		t.Fatal("appointed an existing admin")
	}
}

func TestSessionAbdicateIsVoluntaryAndProtectsLastAdmin(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	memberID := stagePromote(t, admin, guest, room)
	if err := handleRoomAppoint(admin, stageEnvelope(t, "room.appoint", memberID)); err != nil {
		t.Fatal(err)
	}
	abdicate, _ := valueobjects.NewEnvelope("room.abdicate", struct{}{})
	if err := handleRoomAbdicate(admin, abdicate); err != nil {
		t.Fatal(err)
	}
	if room.IsAdmin(admin.userID) {
		t.Fatal("voluntary self-removal retained authority")
	}
	if role, _ := room.RoleOf(admin.userID); role != RoleParticipant {
		t.Fatalf("self-removed admin left the stage: %s", role)
	}
	if !room.IsAdmin(guest.userID) || hub.rooms[room.id] == nil {
		t.Fatal("self-removal disrupted the room or its remaining admin")
	}
	if err := handleRoomAbdicate(guest, abdicate); !errors.Is(err, ErrLastAdmin) {
		t.Fatalf("new last admin abdicated: %v", err)
	}
	stop, _ := valueobjects.NewEnvelope("room.stop", struct{}{})
	if err := handleRoomStop(guest, stop); err != nil {
		t.Fatal(err)
	}
	if hub.rooms[room.id] != nil || hub.users[admin.userID].Room() != "" || hub.users[guest.userID].Room() != "" {
		t.Fatal("stop retained room or membership")
	}
}

func TestSessionLeaveAcknowledgesAndClosesOwnerlessRoom(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	leave, _ := valueobjects.NewEnvelope("room.leave", struct{}{})
	if err := handleRoomLeave(admin, leave); err != nil {
		t.Fatal(err)
	}
	if hub.rooms[room.id] != nil || hub.users[guest.userID].Room() != "" {
		t.Fatal("ownerless room survived")
	}
	if len(admin.send) != 1 {
		t.Fatal("leaver did not receive closure")
	}
}

func TestSessionLeaveReassignsAdminToRemainingStageMember(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	leave, _ := valueobjects.NewEnvelope("room.leave", struct{}{})
	if err := handleRoomLeave(admin, leave); err != nil {
		t.Fatal(err)
	}
	if hub.rooms[room.id] == nil || !room.IsAdmin(guest.userID) {
		t.Fatal("remaining participant did not inherit administration")
	}
}

func TestSessionKickAllowsSpectatorsButRejectsUntrustedSelectors(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	for _, id := range []string{room.memberIDs[admin.userID], guest.userID, fixtureOutsideMemberID} {
		if err := handleRoomKick(admin, stageEnvelope(t, fixtureKickOperation, id)); err == nil {
			t.Fatal("accepted forbidden selector", id)
		}
	}
	if err := handleRoomKick(guest, stageEnvelope(t, fixtureKickOperation, room.memberIDs[admin.userID])); err == nil {
		t.Fatal("spectator kicked admin")
	}
	if err := handleRoomKick(admin, stageEnvelope(t, fixtureKickOperation, room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	if _, present := room.RoleOf(guest.userID); present || hub.users[guest.userID].Room() != "" {
		t.Fatal("kicked spectator retained membership")
	}
}

func TestSessionRemovalRequiresSFURevocation(t *testing.T) {
	for _, op := range []string{fixtureKickOperation, fixtureLeaveOperation, fixtureStopOperation} {
		t.Run(op, func(t *testing.T) {
			hub, admin, actor, room, driver := voiceFixture(t)
			driver.deleteErr = errors.New("SFU unavailable")
			driver.removeErr = driver.deleteErr
			envelope := stageEnvelope(t, op, room.memberIDs[actor.userID])
			var err error
			switch op {
			case fixtureKickOperation:
				err = handleRoomKick(admin, envelope)
			case fixtureLeaveOperation:
				err = handleRoomLeave(actor, envelope)
			case fixtureStopOperation:
				err = handleRoomStop(admin, envelope)
			}
			if err == nil {
				t.Fatal("removal accepted without revoking SFU room")
			}
			if hub.rooms[room.id] == nil {
				t.Fatal("failed removal deleted room")
			}
			if _, present := room.RoleOf(actor.userID); !present {
				t.Fatal("failed removal changed membership")
			}
			driver.deleteErr = nil
			driver.removeErr = nil
			switch op {
			case fixtureKickOperation:
				err = handleRoomKick(admin, envelope)
			case fixtureLeaveOperation:
				err = handleRoomLeave(actor, envelope)
			case "room.stop":
				err = handleRoomStop(admin, envelope)
			}
			if err != nil || (op != fixtureStopOperation && len(driver.removed) != 1) || (op == fixtureStopOperation && len(driver.deleted) != 1) {
				t.Fatal("successful removal did not disconnect SFU member", err)
			}
		})
	}
}
