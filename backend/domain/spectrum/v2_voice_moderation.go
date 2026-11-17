package spectrum

import (
	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	voicedomain "Opinions-sur-Rue/spectrum/domain/voice"
)

func init() {
	v2Handlers["voice.mute"] = handleVoiceMute
	v2Handlers["voice.resume"] = handleVoiceResume
}

// Moderation revokes one publisher, never room membership or other audio peers.
func handleVoiceMute(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		MemberID string `json:"memberId"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	validate := func(room *Room) error {
		actor, present := room.RoleOf(c.userID)
		if room.IsClosed() || !present || actor != RoleAdmin {
			return ErrForbidden
		}
		userID, member := room.userIDForMember(payload.MemberID)
		role, _ := room.RoleOf(userID)
		// Microphone moderation targets participants, never another admin:
		// co-admins resolve that through the room, not through mic fights.
		if member && role == RoleParticipant {
			return nil
		}
		return ErrForbidden
	}
	err = c.hub.voiceChange(roomID, false, "admin_mute", nil,
		func(_ *Room) map[string]bool { return map[string]bool{payload.MemberID: false} },
		validate, func(room *Room) error {
			if room.voiceMuted == nil {
				room.voiceMuted = make(map[string]bool)
			}
			room.voiceMuted[payload.MemberID] = true
			return nil
		})
	if err != nil {
		c.v2Error(envelope, "microphone_mute_failed", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}

// Only a fresh explicit action by the muted member can regain publishing.
// There is deliberately no admin endpoint to unmute somebody else.
func handleVoiceResume(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		RequestID            string `json:"requestId"`
		TranscriptionConsent bool   `json:"transcriptionConsent"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "voice_invalid_request", err)
		return err
	}
	if len(payload.RequestID) > 64 {
		c.v2Error(envelope, "voice_invalid_request", voicedomain.ErrUnavailable)
		return voicedomain.ErrUnavailable
	}
	envelope.ID = payload.RequestID
	if !c.hub.voiceEnabled || c.hub.voiceBackend == nil || c.hub.voiceError != nil {
		c.v2Error(envelope, "voice_unavailable", voicedomain.ErrUnavailable)
		return voicedomain.ErrUnavailable
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "voice_not_in_room", err)
		return err
	}
	validate := func(room *Room) error {
		role, member := room.RoleOf(c.userID)
		identity := room.memberIDs[c.userID]
		if room.IsClosed() || !member || !role.CanPublishVoice() || !room.voiceMuted[identity] {
			return ErrForbidden
		}
		if room.settings.TranscriptionEnabled && c.hub.serverTranscriptionConfigured() {
			generation, accepted := room.transcriptionConsents[identity]
			if !payload.TranscriptionConsent && (!accepted || generation != room.voiceGeneration) {
				return ErrForbidden
			}
		}
		return nil
	}
	err = c.hub.voiceChange(roomID, false, "self_resume", nil,
		func(room *Room) map[string]bool { return map[string]bool{room.memberIDs[c.userID]: true} },
		validate, func(room *Room) error {
			identity := room.memberIDs[c.userID]
			delete(room.voiceMuted, identity)
			if payload.TranscriptionConsent {
				if room.transcriptionConsents == nil {
					room.transcriptionConsents = make(map[string]uint64)
				}
				room.transcriptionConsents[identity] = room.voiceGeneration
			}
			return nil
		})
	if err != nil {
		c.v2Error(envelope, "voice_resume_failed", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return handleVoiceJoin(c, envelope)
}
