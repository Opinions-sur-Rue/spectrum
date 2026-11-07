package spectrum

import (
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func init() {
	v2Handlers["room.hand"] = handleRoomHand
	v2Handlers["room.react"] = handleRoomReact
}

func handleRoomHand(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		MemberID string `json:"memberId"`
		Raised   *bool  `json:"raised"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err == nil {
		err = c.hub.WithRoom(roomID, func(room *Room) error {
			target := c.userID
			if payload.Raised == nil {
				return ErrForbidden
			}
			if payload.MemberID != "" {
				var present bool
				target, present = room.userIDForMember(payload.MemberID)
				if !present {
					return ErrForbidden
				}
			}
			if _, present := room.RoleOf(c.userID); !present {
				return ErrForbidden
			}
			if target != c.userID && (!room.IsAdmin(c.userID) || *payload.Raised) {
				return ErrForbidden
			}
			if room.raisedHands == nil {
				room.raisedHands = make(map[string]int64)
			}
			if *payload.Raised {
				if room.raisedHands[target] == 0 {
					room.raisedHands[target] = time.Now().UnixMilli()
					room.spectrumRevision++
				}
			} else if room.raisedHands[target] != 0 {
				delete(room.raisedHands, target)
				room.spectrumRevision++
			}
			return nil
		})
	}
	if err != nil {
		c.v2Error(envelope, "hand_failed", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}

func handleRoomReact(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		Emoji string `json:"emoji"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	var event struct {
		RoomID   string `json:"roomId"`
		MemberID string `json:"memberId"`
		Nickname string `json:"nickname"`
		Emoji    string `json:"emoji"`
	}
	if err == nil {
		err = c.hub.WithRoom(roomID, func(room *Room) error {
			if role, present := room.RoleOf(c.userID); !present || !role.CanPublishVoice() {
				return ErrForbidden
			}
			switch payload.Emoji {
			case "👍", "👎", "❤️", "👏", "🤔", "😂":
			default:
				return ErrForbidden
			}
			now := time.Now().UnixMilli()
			if now-room.reactionLastSent[c.userID] < 1000 {
				return ErrForbidden
			}
			if room.reactionLastSent == nil {
				room.reactionLastSent = make(map[string]int64)
			}
			room.reactionLastSent[c.userID] = now
			event.RoomID, event.MemberID, event.Nickname, event.Emoji = roomID, room.memberIDs[c.userID], room.memberName(c.hub.users[c.userID]), payload.Emoji
			return nil
		})
	}
	if err != nil {
		c.v2Error(envelope, "reaction_failed", err)
		return err
	}
	// Transient, no replay/history and no positions or signin IDs in the event.
	c.hub.MessageRoomV2(roomID, "room.reaction", event, nil)
	return nil
}
