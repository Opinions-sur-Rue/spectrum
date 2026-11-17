package spectrum

import (
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func init() { v2Handlers["voice.speaking"] = handleVoiceSpeaking }

// One open interval is capped so a suspended tab that never sends its closing
// transition cannot attribute hours of silence to its owner.
const maxSpeakingInterval = 90 * time.Minute

type speakingTimePayload struct {
	RoomID          string `json:"roomId"`
	MemberID        string `json:"memberId"`
	SpeakingSeconds int64  `json:"speakingSeconds"`
}

func boundedSpeakingInterval(since, now int64) int64 {
	if now <= since {
		return 0
	}
	if limit := int64(maxSpeakingInterval / time.Millisecond); now-since > limit {
		return limit
	}
	return now - since
}

func (r *Room) speakingSecondsFor(identity string) int64 {
	total := r.speakingSeconds[identity]
	if since, open := r.speakingStartedAt[identity]; open {
		total += boundedSpeakingInterval(since, time.Now().UnixMilli())
	}
	return total / 1000
}

func (r *Room) startSpeaking(identity string, now int64) bool {
	if _, open := r.speakingStartedAt[identity]; open {
		return false
	}
	if r.speakingStartedAt == nil {
		r.speakingStartedAt = make(map[string]int64)
	}
	if r.speakingSeconds == nil {
		r.speakingSeconds = make(map[string]int64)
	}
	r.speakingStartedAt[identity] = now
	return true
}

func (r *Room) stopSpeaking(identity string, now int64) bool {
	since, open := r.speakingStartedAt[identity]
	if !open {
		return false
	}
	delete(r.speakingStartedAt, identity)
	if r.speakingSeconds == nil {
		r.speakingSeconds = make(map[string]int64)
	}
	r.speakingSeconds[identity] += boundedSpeakingInterval(since, now)
	return true
}

// Speaking time is a facilitation metric, never evidence of audio content.
// Only the caller's own membership is addressable and only an authorized
// publisher can accrue time; repeated or forged flags cannot move another
// member's counter.
func handleVoiceSpeaking(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		Speaking bool `json:"speaking"`
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
	now := time.Now().UnixMilli()
	var identity string
	var seconds int64
	var finished bool
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		if room.IsClosed() {
			return ErrNotInRoom
		}
		role, member := room.RoleOf(c.userID)
		identity = room.memberIDs[c.userID]
		if !member || identity == "" {
			return ErrNotInRoom
		}
		if payload.Speaking {
			if !role.CanPublishVoice() || room.voiceMuted[identity] {
				return nil
			}
			room.startSpeaking(identity, now)
			return nil
		}
		finished = room.stopSpeaking(identity, now)
		seconds = room.speakingSecondsFor(identity)
		return nil
	})
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	// Publish totals when a turn ends, not on every audio-level transition.
	if finished {
		c.hub.MessageRoomV2(roomID, "voice.speaking", speakingTimePayload{RoomID: roomID, MemberID: identity, SpeakingSeconds: seconds}, nil)
	}
	return nil
}
