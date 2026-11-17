package spectrum

import (
	"errors"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func init() {
	v2Handlers["room.leave"] = handleRoomLeave
	v2Handlers["room.stop"] = handleRoomStop
	v2Handlers["room.kick"] = handleRoomKick
	v2Handlers["room.appoint"] = handleRoomAppoint
	v2Handlers["room.abdicate"] = handleRoomAbdicate
}

func handleRoomLeave(c *Client, envelope *valueobjects.Envelope) error {
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err == nil {
		err = c.hub.LeaveRoom(roomID, "", c.userID)
	}
	if err != nil {
		c.v2Error(envelope, "leave_failed", err)
		return err
	}
	c.SendV2("room.closed", map[string]string{"roomId": roomID, "reason": "left"})
	return nil
}

func handleRoomStop(c *Client, envelope *valueobjects.Envelope) error {
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err == nil {
		err = c.hub.stopRoom(roomID, c.userID)
	}
	if err != nil {
		c.v2Error(envelope, "stop_failed", err)
	}
	return err
}

type memberTarget struct {
	MemberID string `json:"memberId"`
}

// ErrLastAdmin keeps a room governable: the only admin has to appoint a
// co-admin before giving up the role.
var ErrLastAdmin = errors.New("room needs another admin first")

// Administration is additive: appointing a co-admin never costs the caller
// their own rights, so a room can never be left without an admin by accident.
func handleRoomAppoint(c *Client, envelope *valueobjects.Envelope) error {
	var payload memberTarget
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err == nil {
		err = c.hub.WithRoom(roomID, func(room *Room) error {
			if !room.IsAdmin(c.userID) {
				return ErrForbidden
			}
			target, present := room.userIDForMember(payload.MemberID)
			role, member := room.RoleOf(target)
			if !present || !member || role != RoleParticipant {
				return ErrForbidden
			}
			// Both roles may publish. No new permission or automatic mic activation.
			return room.AppointAdmin(target)
		})
	}
	if err != nil {
		c.v2Error(envelope, "appoint_failed", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}

// Voluntary self-removal. The last admin must appoint a co-admin first, which
// keeps the room's moderation authority from silently disappearing.
func handleRoomAbdicate(c *Client, envelope *valueobjects.Envelope) error {
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err == nil {
		err = c.hub.WithRoom(roomID, func(room *Room) error {
			if !room.IsAdmin(c.userID) {
				return ErrForbidden
			}
			if len(room.admins) <= 1 {
				return ErrLastAdmin
			}
			room.RemoveAdmin(c.userID)
			return nil
		})
	}
	if err != nil {
		c.v2Error(envelope, "abdicate_failed", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}

func handleRoomKick(c *Client, envelope *valueobjects.Envelope) error {
	var payload memberTarget
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	var target, color string
	if err == nil {
		err = c.hub.voiceRemoval(roomID, voiceReasonKick, func(room *Room) []string { return []string{target} }, func(room *Room) error {
			if !room.IsAdmin(c.userID) {
				return ErrForbidden
			}
			var present bool
			target, present = room.userIDForMember(payload.MemberID)
			if !present || target == c.userID || room.IsAdmin(target) {
				return ErrForbidden
			}
			return nil
		}, func(room *Room) error {
			if actual, onStage := room.ColorOf(target); onStage {
				color = actual
				if err := room.Leave(color); err != nil {
					return err
				}
			}
			room.RemoveSpectator(target)
			if member := c.hub.users[target]; member != nil {
				member.SetRoom("")
				member.SetColor("")
				member.SetMicrophoneEnabled(false)
				member.SetLastVoiceId("")
			}
			return nil
		})
	}
	if err != nil {
		c.v2Error(envelope, "kick_failed", err)
		return err
	}
	c.hub.MessageUser(c.userID, target, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_STOPPED))
	if color != "" {
		c.hub.MessageRoom(roomID, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_USERLEFT, color))
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}
