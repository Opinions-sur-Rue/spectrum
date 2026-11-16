package spectrum

import (
	"testing"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func TestReplacedSocketCloseKeepsCurrentConnectionAndGrace(t *testing.T) {
	hub, old, _, room := stageFixture(t)
	id := old.userID
	user := hub.users[id]
	before := user.beginningGracePeriod
	memberID := room.memberIDs[id]
	user.Nickname = "Mobile host"
	hub.clients[old] = true
	current := &Client{hub: hub, userID: id, send: make(chan []byte, 64)}
	hub.clients[current] = true
	hub.LinkUserWithClient(id, current)
	hub.unregisterClient(old)
	if hub.mappingUserIDToClient[id] != current || user.beginningGracePeriod != before {
		t.Fatal("old socket removed current connection or started its grace period")
	}
	if room.memberIDs[id] != memberID || user.Nickname != "Mobile host" || !room.IsAdmin(id) {
		t.Fatal("reconnection changed identity, nickname or stage authority")
	}
	hub.unregisterClient(old) // A late duplicate close is harmless.
	start := time.Now().Unix()
	hub.unregisterClient(current)
	if hub.mappingUserIDToClient[id] != nil || user.beginningGracePeriod < start {
		t.Fatal("current socket disconnect did not begin grace")
	}
	if hub.gracePeriodSeconds != 60 {
		t.Fatalf("grace changed: %d", hub.gracePeriodSeconds)
	}
}

func TestReconnectPreservesNicknameAndDoesNotUndoDemotion(t *testing.T) {
	hub, admin, old, room := stageFixture(t)
	id := old.userID
	memberID := room.memberIDs[id]
	hub.users[id].Nickname = "Mobile guest"
	target := stageEnvelope(t, "room.promote", memberID)
	if err := handleRoomPromote(admin, target); err != nil {
		t.Fatal(err)
	}
	hub.clients[old] = true
	hub.LinkUserWithClient(id, old)
	hub.unregisterClient(old)
	// Moderation during disconnection remains authoritative on re-admission.
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", memberID)); err != nil {
		t.Fatal(err)
	}
	current := &Client{hub: hub, userID: id, send: make(chan []byte, 64)}
	hub.LinkUserWithClient(id, current)
	join, err := valueobjects.NewEnvelope("room.join", roomJoinPayload{RoomID: room.id})
	if err != nil {
		t.Fatal(err)
	}
	if err := handleRoomJoin(current, join); err != nil {
		t.Fatal(err)
	}
	role, present := room.RoleOf(id)
	if !present || role != RoleSpectator || room.memberIDs[id] != memberID || hub.users[id].Nickname != "Mobile guest" {
		t.Fatal("rejoin changed identity/nickname or undid admin demotion")
	}
}

func TestUnregisterUnsignedClientIsSafe(t *testing.T) {
	hub, _, _, _ := stageFixture(t)
	client := &Client{hub: hub}
	hub.clients[client] = true
	hub.unregisterClient(client)
	if hub.clients[client] {
		t.Fatal("unsigned connection not removed")
	}
}
