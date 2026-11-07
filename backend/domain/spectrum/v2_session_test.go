package spectrum

import (
	"errors"
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func TestSessionTransferIsScopedAndRemovesFormerAdmin(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	target := stageEnvelope(t, "room.transfer", room.memberIDs[guest.userID])
	if err := handleRoomTransfer(admin, target); err == nil {
		t.Fatal("transferred to spectator")
	}
	if err := handleRoomPromote(admin, target); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{admin.userID, guest.userID, fixtureOutsideMemberID} {
		if err := handleRoomTransfer(admin, stageEnvelope(t, "room.transfer", id)); err == nil {
			t.Fatal("accepted invalid member selector", id)
		}
	}
	if err := handleRoomTransfer(guest, target); err == nil {
		t.Fatal("participant transferred authority")
	}
	if err := handleRoomTransfer(admin, target); err != nil {
		t.Fatal(err)
	}
	if role, _ := room.RoleOf(admin.userID); role != RoleParticipant {
		t.Fatal("former admin retained role")
	}
	if !room.IsAdmin(guest.userID) {
		t.Fatal("target not admin")
	}
	stop, _ := valueobjects.NewEnvelope("room.stop", struct{}{})
	if err := handleRoomStop(admin, stop); err == nil {
		t.Fatal("former admin stopped session")
	}
	if hub.rooms[room.id] == nil {
		t.Fatal("unauthorized stop mutated room")
	}
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
			switch op {
			case fixtureKickOperation:
				err = handleRoomKick(admin, envelope)
			case fixtureLeaveOperation:
				err = handleRoomLeave(actor, envelope)
			case "room.stop":
				err = handleRoomStop(admin, envelope)
			}
			if err != nil || len(driver.deleted) != 1 {
				t.Fatal("successful removal did not retire room", err)
			}
		})
	}
}
