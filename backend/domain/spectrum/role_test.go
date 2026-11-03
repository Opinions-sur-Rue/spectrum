package spectrum

import "testing"

func TestRoleOnStage(t *testing.T) {
	tests := []struct {
		role Role
		want bool
	}{
		{RoleSpectator, false},
		{RoleParticipant, true},
		{RoleAdmin, true},
	}

	for _, tt := range tests {
		t.Run(string(tt.role), func(t *testing.T) {
			if got := tt.role.OnStage(); got != tt.want {
				t.Fatalf("OnStage() = %v, want %v", got, tt.want)
			}
			if got := tt.role.CanMovePellet(); got != tt.want {
				t.Fatalf("CanMovePellet() = %v, want %v", got, tt.want)
			}
			if got := tt.role.CanPublishVoice(); got != tt.want {
				t.Fatalf("CanPublishVoice() = %v, want %v", got, tt.want)
			}
			if got := tt.role.CanProposeNotes(); got != tt.want {
				t.Fatalf("CanProposeNotes() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRoleCanModerate(t *testing.T) {
	if !RoleAdmin.CanModerate() {
		t.Fatal("admin must be able to moderate")
	}
	if RoleParticipant.CanModerate() || RoleSpectator.CanModerate() {
		t.Fatal("only admins can moderate")
	}
}

func TestRoleCanChat(t *testing.T) {
	closed := DefaultRoomSettings()
	closed.SpectatorChatEnabled = false

	open := DefaultRoomSettings()
	open.SpectatorChatEnabled = true

	if !RoleAdmin.CanChat(closed) || !RoleParticipant.CanChat(closed) {
		t.Fatal("users on stage can always chat")
	}
	if RoleSpectator.CanChat(closed) {
		t.Fatal("spectators cannot chat when the admin disabled it")
	}
	if !RoleSpectator.CanChat(open) {
		t.Fatal("spectators can chat when the admin enabled it")
	}
}

func TestRoleIsValid(t *testing.T) {
	for _, role := range []Role{RoleAdmin, RoleParticipant, RoleSpectator} {
		if !role.IsValid() {
			t.Fatalf("%q should be valid", role)
		}
	}
	if Role("moderator").IsValid() {
		t.Fatal("unknown role must be invalid")
	}
}
