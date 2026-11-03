package spectrum

// Role is the stage role of a user inside a room.
//
// The stage model is: every user joins as a spectator, and admins promote
// them to participant. Voice permission is derived strictly from the role,
// there is no per-user override.
type Role string

const (
	// RoleSpectator watches and listens. No pellet, no voice publish.
	RoleSpectator Role = "spectator"
	// RoleParticipant owns a pellet on the spectrum and may publish voice.
	RoleParticipant Role = "participant"
	// RoleAdmin manages the room and is also a participant.
	RoleAdmin Role = "admin"
)

// IsValid reports whether the role is one of the three known roles.
func (r Role) IsValid() bool {
	switch r {
	case RoleSpectator, RoleParticipant, RoleAdmin:
		return true
	default:
		return false
	}
}

// OnStage reports whether the role owns a slot on the stage.
func (r Role) OnStage() bool {
	return r == RoleParticipant || r == RoleAdmin
}

// CanMovePellet reports whether the role owns a pellet on the spectrum.
func (r Role) CanMovePellet() bool {
	return r.OnStage()
}

// CanPublishVoice reports whether the role may publish audio to the room.
// A spectator who wants to speak must be promoted to participant first.
func (r Role) CanPublishVoice() bool {
	return r.OnStage()
}

// CanModerate reports whether the role may approve, reveal and edit any note.
func (r Role) CanModerate() bool {
	return r == RoleAdmin
}

// CanProposeNotes reports whether the role may submit a note to the
// moderation queue. Only users on stage may propose notes.
func (r Role) CanProposeNotes() bool {
	return r.OnStage()
}

// CanChat reports whether the role may send chat messages given the room
// settings. Spectators only get chat when the admin enables it.
func (r Role) CanChat(settings RoomSettings) bool {
	if r.OnStage() {
		return true
	}
	return r == RoleSpectator && settings.SpectatorChatEnabled
}
