package spectrum

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"regexp"
	"slices"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	log "github.com/sirupsen/logrus"
)

var (
	newPositions   = []string{"569,514", "509,521", "426,521", "514,566", "424,569", "382,523"}
	procedureRegex = regexp.MustCompile(`^(emoji|signin|nickname|voicechat|startspectrum|joinspectrum|leavespectrum|resetpositions|update|claim|makeadmin|microphoneunmute|microphonemute|kick)$`)
	//hexadecimalRegex = regexp.MustCompile(`^([0-9a-f-]*)$`)
	//emojiRegex       = regexp.MustCompile(`^([\x{1F600}-\x{1F6FF}|[\x{2600}-\x{26FF}]|[\x{1FAE3}]|[\x{1F92F}]|[\x{1F91A}]|[\x{1F914}]||[\x{1F99D}]|[\x{1FAE1}]|[\x{1F6DF}])$`)
	//coordsRegex      = regexp.MustCompile(`^([0-9]+,[0-9]+)$`)
)

var (
	ErrCommandNotRecognized = errors.New("command not recognized")
	ErrCannotReachOpponent  = errors.New("cannot reach opponent")
	ErrCannotParseCoords    = errors.New("cannot parse coords")
	ErrUnexpected           = errors.New("unexpected error")
)

//nolint:gocyclo
func (c *Client) EvaluateRPC(rpc *valueobjects.MessageContent) error {
	if rpc == nil {
		return errors.Join(ErrUnexpected)
	}

	if !procedureRegex.Match([]byte(rpc.Procedure)) {
		return errors.Join(ErrCommandNotRecognized, fmt.Errorf("procedure %s does not match regex", rpc.Procedure))
	}

	log.Debug("RPC " + rpc.Procedure)

	user := c.hub.users[c.userID]

	switch rpc.Procedure {
	case "emoji":
		if user.IsInRoom() {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_RECEIVE, user.Color, rpc.Arguments[0])
			c.hub.MessageRoom(user.Room(), reply)
		}
	case "signin":
		c.SetUserID(rpc.Arguments[0])
		c.hub.LinkUserWithClient(c.UserID(), c)
		c.send <- valueobjects.NewMessageContent(valueobjects.RPC_ACK).Export()

		if user.IsInRoom() {
			user.beginningGracePeriod = math.MaxInt64 - 100

			roomID := user.currentRoomID
			admin := slices.Contains(c.hub.rooms[roomID].admins, c.userID)

			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_SPECTRUM, user.Color, roomID, user.Nickname, fmt.Sprintf("%t", admin))
			c.send <- reply.Export()

			for _, participant := range c.hub.rooms[roomID].participants {
				adminUser := ""
				if slices.Contains(c.hub.rooms[roomID].admins, participant.UserID) {
					adminUser = "*"
				}
				reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_UPDATE, participant.Color, participant.LastPosition(), participant.Nickname, adminUser)
				c.send <- reply.Export()
			}

			reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NEWPOSITION, user.LastPosition())
			c.hub.MessageUser(c.UserID(), c.UserID(), reply)

			reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_CLAIM, c.hub.rooms[roomID].Topic())
			c.hub.MessageUser(c.UserID(), c.UserID(), reply)
		}
	case "nickname":
		c.send <- valueobjects.NewMessageContent(valueobjects.RPC_ACK).Export()
		user.SetNickname(rpc.Arguments[0])
	case "startspectrum":
		if user.IsInRoom() {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, "already in a room")
			c.send <- reply.Export()
			break
		}

		roomID, color, err := c.hub.NewRoom(c.UserID())
		if err != nil {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
			c.send <- reply.Export()
			break
		}
		user.SetRoom(roomID)
		user.SetColor(color)
		user.SetNickname(rpc.Arguments[0])

		reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_SPECTRUM, color, roomID, rpc.Arguments[0], "true")
		c.send <- reply.Export()
	case "joinspectrum":
		if user.IsInRoom() {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, "already in a room")
			c.send <- reply.Export()
			break
		}

		roomID := rpc.Arguments[0]
		color, err := c.hub.JoinRoom(roomID, c.UserID())
		if err != nil {
			// Nothing
			log.Error(err.Error())
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
			c.send <- reply.Export()
		} else {
			user.SetNickname(rpc.Arguments[1])
			user.SetColor(color)
			user.SetRoom(roomID)

			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_SPECTRUM, color, roomID, rpc.Arguments[1], "false")
			c.send <- reply.Export()

			reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NEWPOSITION, newPositions[rand.Intn(len(newPositions))%len(newPositions)])
			c.hub.MessageUser(c.UserID(), c.UserID(), reply)

			for _, participant := range c.hub.rooms[roomID].participants {
				adminUser := ""
				if slices.Contains(c.hub.rooms[roomID].admins, participant.UserID) {
					adminUser = "*"
				}
				reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_UPDATE, participant.Color, participant.LastPosition(), participant.Nickname, adminUser)
				c.send <- reply.Export()
			}
			reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_CLAIM, c.hub.rooms[roomID].Topic())
			c.hub.MessageUser(c.UserID(), c.UserID(), reply)
		}
	case "leavespectrum":
		if !user.IsInRoom() {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, "not in a room")
			c.send <- reply.Export()
			break
		}

		roomID := user.Room()
		err := c.hub.rooms[roomID].Leave(user.Color)
		if err != nil {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
			c.send <- reply.Export()
			break
		}
		c.send <- valueobjects.NewMessageContent(valueobjects.RPC_ACK).Export()

		reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_USERLEFT, user.Color)
		c.hub.MessageRoom(roomID, reply)
		user.SetColor("")
		user.SetRoom("")
	case "myposition":
		if user.IsInRoom() {
			user.SetLastPosition(rpc.Arguments[0])
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_UPDATE, user.Color, rpc.Arguments[0])
			c.hub.MessageRoom(user.Room(), reply)
		}
	case "makeadmin":
		if user.IsInRoom() {
			roomID := user.Room()
			err := c.hub.rooms[roomID].SetAdminByColor(rpc.Arguments[0])
			if err != nil {
				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
				c.send <- reply.Export()
				break
			}

			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_MADEADMIN, rpc.Arguments[0])
			c.hub.MessageRoom(roomID, reply)
		}
	case "resetpositions":
		if user.IsInRoom() {
			room := c.hub.rooms[user.Room()]
			var i = 0
			for _, user := range room.participants {
				if slices.Contains(room.admins, user.UserID) {
					continue
				}
				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NEWPOSITION, newPositions[i%len(newPositions)])
				c.hub.MessageUser(c.UserID(), user.UserID, reply)
				i = i + 1
			}
		}
	case "kick":
		if user.IsInRoom() {
			roomID := user.Room()
			if c.hub.rooms[roomID].IsAdmin(c.UserID()) {
				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_USERLEFT, rpc.Arguments[0])
				c.hub.MessageRoom(roomID, reply)
				err := c.hub.rooms[roomID].Leave(rpc.Arguments[0])
				if err != nil {
					reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
					c.send <- reply.Export()
					break
				}
				for _, user := range c.hub.users {
					if user.Color == rpc.Arguments[0] && user.Room() == roomID {
						user.SetColor("")
						user.SetRoom("")
					}
				}
			}
		}
	case "claim":
		if user.IsInRoom() {
			roomID := user.Room()
			c.hub.rooms[roomID].SetTopic(rpc.Arguments[0])
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_CLAIM, rpc.Arguments[0])
			c.hub.MessageRoom(roomID, reply)
		}
	case "myvoicechatid":
		if user.IsInRoom() {
			user.SetLastVoiceId(rpc.Arguments[0])
			roomID := user.Room()

			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_VOICECHAT, user.Color, rpc.Arguments[0])
			c.hub.MessageRoom(roomID, reply)

			for _, participant := range c.hub.rooms[roomID].participants {
				if participant.LastVoiceId() != "" && participant.UserID != c.UserID() {
					reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_VOICECHAT, participant.Color, participant.LastVoiceId())
					c.send <- reply.Export()

					if participant.MicrophoneEnabled() {
						reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_MICROPHONEUNMUTED, participant.Color)
					} else {
						reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_MICROPHONEMUTED, participant.Color)
					}
					c.send <- reply.Export()
				}
			}
		}
	case "unmutedmymicrophone":
		if user.IsInRoom() {
			user.SetMicrophoneEnabled(true)
			roomID := user.Room()
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_MICROPHONEUNMUTED, user.Color)
			c.hub.MessageRoom(roomID, reply)
		}
	case "mutedmymicrophone":
		if user.IsInRoom() {
			user.SetMicrophoneEnabled(false)
			roomID := user.Room()
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_MICROPHONEMUTED, user.Color)
			c.hub.MessageRoom(roomID, reply)
		}
	default:
		return ErrCommandNotRecognized
	}

	return nil
}
