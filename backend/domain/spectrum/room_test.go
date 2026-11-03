package spectrum

import (
	"errors"
	"testing"
)

func newTestRoom(t *testing.T) (*Room, *User) {
	t.Helper()

	admin := NewUser("admin")
	room := NewRoom(admin, "room-1", "a topic")

	if _, err := room.AddUser(admin); err != nil {
		t.Fatalf("AddUser(admin): %v", err)
	}

	return room, admin
}

func TestRoomRoleOf(t *testing.T) {
	room, admin := newTestRoom(t)

	role, ok := room.RoleOf(admin.UserID)
	if !ok || role != RoleAdmin {
		t.Fatalf("RoleOf(admin) = %q, %v; want admin, true", role, ok)
	}

	spectator := NewUser("spectator-1")
	if err := room.AddSpectator(spectator); err != nil {
		t.Fatalf("AddSpectator: %v", err)
	}

	role, ok = room.RoleOf(spectator.UserID)
	if !ok || role != RoleSpectator {
		t.Fatalf("RoleOf(spectator) = %q, %v; want spectator, true", role, ok)
	}

	role, ok = room.RoleOf("ghost")
	if ok || role != RoleSpectator {
		t.Fatalf("RoleOf(ghost) = %q, %v; want spectator, false", role, ok)
	}
}

func TestRoomPromoteAndDemote(t *testing.T) {
	room, _ := newTestRoom(t)

	spectator := NewUser("spectator-1")
	if err := room.AddSpectator(spectator); err != nil {
		t.Fatalf("AddSpectator: %v", err)
	}

	color, err := room.Promote(spectator.UserID)
	if err != nil {
		t.Fatalf("Promote: %v", err)
	}
	if color == "" {
		t.Fatal("Promote must assign a color")
	}

	role, _ := room.RoleOf(spectator.UserID)
	if role != RoleParticipant {
		t.Fatalf("role after Promote = %q, want participant", role)
	}
	if spectator.Color != color {
		t.Fatalf("user color = %q, want %q", spectator.Color, color)
	}

	if err := room.Demote(spectator.UserID); err != nil {
		t.Fatalf("Demote: %v", err)
	}

	role, _ = room.RoleOf(spectator.UserID)
	if role != RoleSpectator {
		t.Fatalf("role after Demote = %q, want spectator", role)
	}
	if spectator.Color != "" {
		t.Fatalf("user color after Demote = %q, want empty", spectator.Color)
	}
	if spectator.LastPosition() != PositionNA {
		t.Fatalf("position after Demote = %q, want %q", spectator.LastPosition(), PositionNA)
	}
}

func TestRoomPromoteUnknownSpectator(t *testing.T) {
	room, _ := newTestRoom(t)

	if _, err := room.Promote("ghost"); !errors.Is(err, ErrUserNotOnBench) {
		t.Fatalf("Promote(ghost) error = %v, want ErrUserNotOnBench", err)
	}
}

func TestRoomDemoteUnknownParticipant(t *testing.T) {
	room, _ := newTestRoom(t)

	if err := room.Demote("ghost"); !errors.Is(err, ErrUserNotOnStage) {
		t.Fatalf("Demote(ghost) error = %v, want ErrUserNotOnStage", err)
	}
}

func TestRoomParticipantSlotsEnforced(t *testing.T) {
	room, _ := newTestRoom(t)

	settings := room.Settings()
	settings.ParticipantSlots = 1
	room.SetSettings(settings)

	spectator := NewUser("spectator-1")
	if err := room.AddSpectator(spectator); err != nil {
		t.Fatalf("AddSpectator: %v", err)
	}

	if _, err := room.Promote(spectator.UserID); !errors.Is(err, ErrRoomFull) {
		t.Fatalf("Promote on a full stage error = %v, want ErrRoomFull", err)
	}

	role, _ := room.RoleOf(spectator.UserID)
	if role != RoleSpectator {
		t.Fatalf("role = %q, want spectator after a failed promotion", role)
	}
}

func TestRoomSpectatorLimitEnforced(t *testing.T) {
	room, _ := newTestRoom(t)

	settings := room.Settings()
	settings.SpectatorLimit = 1
	room.SetSettings(settings)

	if err := room.AddSpectator(NewUser("spectator-1")); err != nil {
		t.Fatalf("AddSpectator: %v", err)
	}
	if err := room.AddSpectator(NewUser("spectator-2")); !errors.Is(err, ErrSpectatorLimitReached) {
		t.Fatalf("second AddSpectator error = %v, want ErrSpectatorLimitReached", err)
	}
}

func TestRoomAddSpectatorIsIdempotent(t *testing.T) {
	room, _ := newTestRoom(t)

	spectator := NewUser("spectator-1")
	if err := room.AddSpectator(spectator); err != nil {
		t.Fatalf("first AddSpectator: %v", err)
	}
	if err := room.AddSpectator(spectator); err != nil {
		t.Fatalf("second AddSpectator: %v", err)
	}

	if room.MemberCount() != 2 {
		t.Fatalf("MemberCount = %d, want 2", room.MemberCount())
	}
}

func TestRoomDemoteAdminReleasesAdminRole(t *testing.T) {
	room, admin := newTestRoom(t)

	other := NewUser("admin-2")
	if _, err := room.AddUser(other); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if err := room.SetAdmin(other); err != nil {
		t.Fatalf("SetAdmin: %v", err)
	}

	if err := room.Demote(admin.UserID); err != nil {
		t.Fatalf("Demote(admin): %v", err)
	}

	if room.IsAdmin(admin.UserID) {
		t.Fatal("demoted user must lose the admin role")
	}
	role, _ := room.RoleOf(other.UserID)
	if role != RoleAdmin {
		t.Fatalf("remaining admin role = %q, want admin", role)
	}
}

func TestRoomDemoteFailsWithoutPartialMutation(t *testing.T) {
	room, _ := newTestRoom(t)

	settings := room.Settings()
	settings.SpectatorLimit = 1
	room.SetSettings(settings)

	if err := room.AddSpectator(NewUser("spectator-1")); err != nil {
		t.Fatalf("AddSpectator: %v", err)
	}

	participant := NewUser("participant-1")
	if _, err := room.AddUser(participant); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	if err := room.Demote(participant.UserID); !errors.Is(err, ErrSpectatorLimitReached) {
		t.Fatalf("Demote error = %v, want ErrSpectatorLimitReached", err)
	}

	role, _ := room.RoleOf(participant.UserID)
	if role != RoleParticipant {
		t.Fatalf("role = %q, want participant after a failed demotion", role)
	}
}
