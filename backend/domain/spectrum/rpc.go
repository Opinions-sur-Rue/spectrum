package spectrum

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"regexp"
	"slices"

	"Opinions-sur-Rue/spectrum/domain/social"
	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	log "github.com/sirupsen/logrus"
)

var (
	newPositions    = []string{"431,582", "502,564", "503,623", "574,591", "416,553", "576,543"}
	centerPositions = []string{"392,57", "484,59", "475,99", "401,100", "404,147", "468,149"}
	procedureRegex  = regexp.MustCompile(`^(sendchatmessage|listen|disconnect|mutedmymicrophone|unmutedmymicrophone|myvoicechatid|myposition|emoji|signin|nickname|voicechat|startspectrum|joinspectrum|leavespectrum|resetpositions|update|claim|makeadmin|microphoneunmute|microphonemute|kick|lowerhand|hideall|showall)$`)
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
	log.Debug(rpc.Arguments)

	user := c.hub.GetUser(c.userID)

	switch rpc.Procedure {
	case "emoji":
		if user.IsInRoom() {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_RECEIVE, user.Color, rpc.Arguments[0])
			c.hub.MessageRoom(user.Room(), reply)
		}
	case "lowerhand":
		if user.IsInRoom() {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_HANDLOWERED, user.Color)
			c.hub.MessageRoom(user.Room(), reply)
		}
	case "signin":
		c.SetUserID(rpc.Arguments[0])
		c.hub.LinkUserWithClient(c.UserID(), c)
		c.send <- valueobjects.NewMessageContentWithArgs(valueobjects.RPC_ACK, "signin").Export()

		user = c.hub.GetUser(c.userID)

		if user != nil && user.IsInRoom() {
			c.hub.SetUserGracePeriod(c.userID, math.MaxInt64-100)

			roomID := user.currentRoomID
			c.hub.WithRoomRead(roomID, func(room *Room) {
				admin := slices.Contains(room.admins, c.userID)
				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_SPECTRUM, user.Color, roomID, user.Nickname, fmt.Sprintf("%t", admin), fmt.Sprintf("%t", room.showNeutralCircle))
				c.send <- reply.Export()

				for _, participant := range room.participants {
					adminUser := ""
					if slices.Contains(room.admins, participant.UserID) {
						adminUser = "*"
					}
					pos := participant.LastPosition()
					if room.participantsHidden && !admin {
						pos = "N,A"
					}
					reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_UPDATE, participant.Color, pos, participant.Nickname, adminUser)
					c.send <- reply.Export()
				}

				reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_CLAIM, room.Topic())
				c.send <- reply.Export()

				if room.participantsHidden {
					reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_PARTICIPANTSHIDDEN)
					c.send <- reply.Export()
				}

				if room.SocialListener() != nil {
					reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LISTENNING, room.SocialListener().GetType())
					c.send <- reply.Export()
				}
			})

			if user.LastPosition() != "N,A" {
				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NEWPOSITION, user.LastPosition())
				c.hub.MessageUser(c.UserID(), c.UserID(), reply)
			}
		}
	case "nickname":
		c.send <- valueobjects.NewMessageContentWithArgs(valueobjects.RPC_ACK, "nickname").Export()
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

		showNeutralCircle := len(rpc.Arguments) < 2 || rpc.Arguments[1] != "false"
		_ = c.hub.WithRoom(roomID, func(room *Room) error {
			room.showNeutralCircle = showNeutralCircle
			return nil
		})

		reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_SPECTRUM, color, roomID, rpc.Arguments[0], "true", fmt.Sprintf("%t", showNeutralCircle))
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
			log.Error(err.Error())
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
			c.send <- reply.Export()
		} else {
			user.SetNickname(rpc.Arguments[1])
			user.SetColor(color)
			user.SetRoom(roomID)

			var roomShowNeutralCircle = true
			c.hub.WithRoomRead(roomID, func(room *Room) {
				roomShowNeutralCircle = room.showNeutralCircle
			})

			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_SPECTRUM, color, roomID, rpc.Arguments[1], "false", fmt.Sprintf("%t", roomShowNeutralCircle))
			c.send <- reply.Export()

			if roomShowNeutralCircle {
				reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NEWPOSITION, newPositions[rand.Intn(len(newPositions))])
				c.hub.MessageUser(c.UserID(), c.UserID(), reply)
			} else {
				reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NEWPOSITION, centerPositions[rand.Intn(len(centerPositions))])
				c.hub.MessageUser(c.UserID(), c.UserID(), reply)
			}

			c.hub.WithRoomRead(roomID, func(room *Room) {
				for _, participant := range room.participants {
					adminUser := ""
					if slices.Contains(room.admins, participant.UserID) {
						adminUser = "*"
					}
					pos := participant.LastPosition()
					if room.participantsHidden && !slices.Contains(room.admins, c.UserID()) {
						pos = "N,A"
					}
					reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_UPDATE, participant.Color, pos, participant.Nickname, adminUser)
					c.send <- reply.Export()
				}
				reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_CLAIM, room.Topic())
				c.send <- reply.Export()

				if room.participantsHidden && slices.Contains(room.admins, c.UserID()) {
					reply = valueobjects.NewMessageContentWithArgs(valueobjects.RPC_PARTICIPANTSHIDDEN)
					c.send <- reply.Export()
				}
			})
		}
	case "leavespectrum":
		if !user.IsInRoom() {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, "not in a room")
			c.send <- reply.Export()
			break
		}

		roomID := user.Room()
		err := c.hub.LeaveRoom(roomID, user.Color, user.UserID)
		if err != nil {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
			c.send <- reply.Export()
			break
		}
		c.send <- valueobjects.NewMessageContentWithArgs(valueobjects.RPC_ACK, "leavespectrum").Export()

		reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_USERLEFT, user.Color)
		c.hub.MessageRoom(roomID, reply)
		user.SetColor("")
		user.SetRoom("")
	case "myposition":
		if user.IsInRoom() {
			user.SetLastPosition(rpc.Arguments[0])
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_UPDATE, user.Color, rpc.Arguments[0], rpc.Arguments[1])
			roomID := user.Room()
			hidden := false
			c.hub.WithRoomRead(roomID, func(room *Room) {
				hidden = room.participantsHidden
				if hidden {
					for _, p := range room.participants {
						if slices.Contains(room.admins, p.UserID) && p.UserID != c.UserID() {
							c.hub.MessageUser(c.UserID(), p.UserID, reply)
						}
					}
				}
			})
			if !hidden {
				c.hub.MessageRoom(roomID, reply)
			}
		}
	case "makeadmin":
		if user.IsInRoom() {
			roomID := user.Room()
			err := c.hub.WithRoom(roomID, func(room *Room) error {
				return room.SetAdminByColor(rpc.Arguments[0])
			})
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
			roomID := user.Room()
			i := 0
			c.hub.WithRoomRead(roomID, func(room *Room) {
				positions := newPositions
				if !room.showNeutralCircle {
					positions = centerPositions
				}
				for _, u := range room.participants {
					if slices.Contains(room.admins, u.UserID) {
						continue
					}
					reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NEWPOSITION, positions[i%len(positions)])
					c.hub.MessageUser(c.UserID(), u.UserID, reply)
					i++
				}
			})
		}
	case "kick":
		if user.IsInRoom() {
			roomID := user.Room()
			room := c.hub.GetRoom(roomID)
			if room == nil {
				break
			}
			if room.IsAdmin(c.UserID()) {
				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_USERLEFT, rpc.Arguments[0])
				c.hub.MessageRoom(roomID, reply)
				err := c.hub.WithRoom(roomID, func(room *Room) error {
					return room.Leave(rpc.Arguments[0])
				})
				if err != nil {
					reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
					c.send <- reply.Export()
					break
				}
				// Clear room/color for the kicked user
				c.hub.ClearUserByColor(roomID, rpc.Arguments[0])
			}
		}
	case "claim":
		if user.IsInRoom() {
			roomID := user.Room()
			_ = c.hub.WithRoom(roomID, func(room *Room) error {
				room.SetTopic(rpc.Arguments[0])
				return nil
			})
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_CLAIM, rpc.Arguments[0])
			c.hub.MessageRoom(roomID, reply)
		}
	case "myvoicechatid":
		if user.IsInRoom() {
			user.SetLastVoiceId(rpc.Arguments[0])
			roomID := user.Room()
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_VOICECHAT, user.Color, rpc.Arguments[0])
			c.hub.MessageRoom(roomID, reply)

			c.hub.WithRoomRead(roomID, func(room *Room) {
				for _, participant := range room.participants {
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
			})
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
	case "listen":
		if user.IsInRoom() {
			roomID := user.Room()
			room := c.hub.GetRoom(roomID)
			if room == nil {
				break
			}
			if !room.IsAdmin(c.UserID()) {
				break
			}
			if room.SocialListener() != nil {
				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, "already connected")
				c.send <- reply.Export()
				break
			}

			listener, err := social.CreateListener(rpc.Arguments[0], "^\\s*spectrum\\s+-?[0-3i]\\s*$", rpc.Arguments[2])
			if err != nil {
				log.Error(err.Error())
				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
				c.send <- reply.Export()
				break
			}

			_ = c.hub.WithRoom(roomID, func(room *Room) error {
				room.SetSocialListener(listener)
				return nil
			})

			go func() {
				messageRoom := func(reply *valueobjects.MessageContent) {
					c.hub.MessageRoom(roomID, reply)
				}
				err := listener.Connect(c.hub.context, rpc.Arguments[1], messageRoom)
				if err != nil {
					log.Error(err.Error())
					reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
					c.send <- reply.Export()
					_ = c.hub.WithRoom(roomID, func(room *Room) error {
						room.SetSocialListener(nil)
						return nil
					})
				}
			}()

			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LISTENNING, rpc.Arguments[0])
			c.hub.MessageRoom(roomID, reply)
		}
	case "sendchatmessage":
		if user.IsInRoom() {
			roomID := user.Room()
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_CHATMESSAGE, user.Color, rpc.Arguments[0])
			c.hub.MessageRoom(roomID, reply)
		}
	case "disconnect":
		if user.IsInRoom() {
			roomID := user.Room()
			room := c.hub.GetRoom(roomID)
			if room == nil {
				break
			}
			if !room.IsAdmin(c.UserID()) {
				break
			}
			if room.SocialListener() == nil {
				break
			}
			err := room.SocialListener().Disconnect()
			if err != nil {
				log.Error(err.Error())
				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_NACK, err.Error())
				c.send <- reply.Export()
				break
			}
			_ = c.hub.WithRoom(roomID, func(room *Room) error {
				room.SetSocialListener(nil)
				return nil
			})
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_ACK, "disconnect")
			c.send <- reply.Export()
		}
	case "hideall":
		if user.IsInRoom() {
			roomID := user.Room()
			room := c.hub.GetRoom(roomID)
			if room == nil {
				break
			}
			if !room.IsAdmin(c.UserID()) {
				break
			}
			_ = c.hub.WithRoom(roomID, func(room *Room) error {
				room.participantsHidden = true
				return nil
			})
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_PARTICIPANTSHIDDEN)
			c.hub.MessageRoom(roomID, reply)
		}
	case "showall":
		if user.IsInRoom() {
			roomID := user.Room()
			room := c.hub.GetRoom(roomID)
			if room == nil {
				break
			}
			if !room.IsAdmin(c.UserID()) {
				break
			}
			_ = c.hub.WithRoom(roomID, func(room *Room) error {
				room.participantsHidden = false
				return nil
			})
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_PARTICIPANTSSHOWN)
			c.hub.MessageRoom(roomID, reply)
			var updates []*valueobjects.MessageContent
			c.hub.WithRoomRead(roomID, func(room *Room) {
				for _, p := range room.participants {
					adminUser := ""
					if slices.Contains(room.admins, p.UserID) {
						adminUser = "*"
					}
					updates = append(updates, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_UPDATE, p.Color, p.LastPosition(), p.Nickname, adminUser))
				}
			})
			for _, update := range updates {
				c.hub.MessageRoom(roomID, update)
			}
		}
	default:
		return ErrCommandNotRecognized
	}

	return nil
}
