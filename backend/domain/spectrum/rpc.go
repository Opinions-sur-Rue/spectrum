package spectrum

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"regexp"
	"slices"
	"strings"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	log "github.com/sirupsen/logrus"
)

const (
	spectrum    = "spectrum "
	newposition = "newposition "
	update      = "update "
	userleft    = "userleft "
)

var (
	newPositions = []string{"569,514", "509,521", "426,521", "514,566", "424,569", "382,523"}
	r            = regexp.MustCompile(`^(emoji|signin|nickname|voicechat|startspectrum|joinspectrum|leavespectrum|resetpositions|update|claim|makeadmin|microphoneunmute|microphonemute|kick)(\s+([0-9a-f-]*))?(\s+([0-9]+,[0-9]+))?(\s+([\x{1F600}-\x{1F6FF}|[\x{2600}-\x{26FF}]|[\x{1FAE3}]|[\x{1F92F}]|[\x{1F91A}]|[\x{1F914}]||[\x{1F99D}]|[\x{1FAE1}]|[\x{1F6DF}]))?(\s+(.+))?$`)
)

var (
	ErrCommandNotRecognized = errors.New("command not recognized")
	ErrCannotReachOpponent  = errors.New("cannot reach opponent")
	ErrCannotParseCoords    = errors.New("cannot parse coords")
	ErrUnexpected           = errors.New("unexpected error")
)

//nolint:gocyclo
func (c *Client) EvaluateRPC(command string) error {
	subMatch := r.FindStringSubmatch(command)
	if subMatch == nil {
		return errors.Join(ErrCommandNotRecognized, errors.New(command))
	}

	log.Debug("RPC " + subMatch[0])

	switch {
	case subMatch[1] == "emoji":
		if c.hub.users[c.UserID()].IsInRoom() {
			c.hub.MessageRoom(c.hub.users[c.UserID()].Room(), "receive "+c.hub.users[c.UserID()].Color+" "+subMatch[7])
		}
	case subMatch[1] == "signin":
		c.SetUserID(subMatch[3])
		c.hub.LinkUserWithClient(c.UserID(), c)
		c.send <- valueobjects.RPC_ACK.Export()
		if c.hub.users[c.userID].IsInRoom() {
			c.hub.users[c.userID].beginningGracePeriod = math.MaxInt64 - 100
			roomID := c.hub.users[c.userID].currentRoomID
			admin := slices.Contains(c.hub.rooms[roomID].admins, c.userID)
			c.send <- []byte(spectrum + c.hub.users[c.userID].Color + " " + c.hub.users[c.userID].currentRoomID + " " + c.hub.users[c.userID].Nickname + " " + fmt.Sprintf("%t", admin))

			for _, participant := range c.hub.rooms[roomID].participants {
				adminUser := ""
				if slices.Contains(c.hub.rooms[roomID].admins, participant.UserID) {
					adminUser = "*"
				}
				c.send <- []byte(update + participant.Color + " " + participant.LastPosition() + " " + participant.Nickname + adminUser)
			}
			c.hub.MessageUser(c.UserID(), c.UserID(), newposition+c.hub.users[c.userID].LastPosition())
			c.hub.MessageUser(c.UserID(), c.UserID(), "claim "+c.hub.rooms[roomID].Topic())
		}
	case subMatch[1] == "nickname":
		c.send <- valueobjects.RPC_ACK.Export()
		c.hub.users[c.UserID()].SetNickname(subMatch[9])
	case subMatch[1] == "startspectrum":
		spt := strings.Split(subMatch[9], " ")
		roomID, color, err := c.hub.NewRoom(c.UserID())
		if err != nil {
			c.send <- valueobjects.RPC_NACK.ExportWith(err.Error())
			break
		}
		c.hub.users[c.UserID()].SetRoom(roomID)
		c.hub.users[c.UserID()].SetColor(color)
		c.hub.users[c.UserID()].SetNickname(spt[0])
		c.send <- []byte(spectrum + color + " " + roomID + " " + spt[0] + " true")
	case subMatch[1] == "joinspectrum":
		spt := strings.Split(subMatch[9], " ")
		roomID := spt[0]
		color, err := c.hub.JoinRoom(roomID, c.UserID())
		if err != nil {
			// Nothing
			log.Error(err.Error())
			c.send <- valueobjects.RPC_NACK.ExportWith(err.Error())
		} else {
			c.hub.users[c.UserID()].SetNickname(spt[1])
			c.hub.users[c.UserID()].SetColor(color)
			c.hub.users[c.UserID()].SetRoom(roomID)
			c.send <- []byte(spectrum + color + " " + roomID + " " + spt[1] + " false")
			c.hub.MessageUser(c.UserID(), c.UserID(), newposition+newPositions[rand.Intn(len(newPositions))%len(newPositions)])

			for _, participant := range c.hub.rooms[roomID].participants {
				adminUser := ""
				if slices.Contains(c.hub.rooms[roomID].admins, participant.UserID) {
					adminUser = "*"
				}
				c.send <- []byte(update + participant.Color + " " + participant.LastPosition() + " " + participant.Nickname + adminUser)
			}
			c.hub.MessageUser(c.UserID(), c.UserID(), "claim "+c.hub.rooms[roomID].Topic())
		}
	case subMatch[1] == "leavespectrum":
		roomID := c.hub.users[c.userID].currentRoomID
		err := c.hub.rooms[roomID].Leave(c.hub.users[c.userID].Color)
		if err != nil {
			c.send <- valueobjects.RPC_NACK.ExportWith(err.Error())
			break
		}
		c.send <- valueobjects.RPC_ACK.Export()
		c.hub.MessageRoom(roomID, userleft+c.hub.users[c.userID].Color)
		c.hub.users[c.userID].SetColor("")
		c.hub.users[c.userID].SetRoom("")
	case subMatch[1] == "update":
		if c.hub.users[c.UserID()].IsInRoom() {
			c.hub.users[c.userID].SetLastPosition(subMatch[5])
			c.hub.MessageRoom(c.hub.users[c.UserID()].Room(), command)
		}
	case subMatch[1] == "makeadmin":
		if c.hub.users[c.UserID()].IsInRoom() {
			roomID := c.hub.users[c.UserID()].Room()
			err := c.hub.rooms[roomID].SetAdminByColor(subMatch[3])
			if err != nil {
				c.send <- valueobjects.RPC_NACK.ExportWith(err.Error())
				break
			}

			c.hub.MessageRoom(roomID, "madeadmin "+subMatch[3])
		}
	case subMatch[1] == "resetpositions":
		if c.hub.users[c.UserID()].IsInRoom() {
			room := c.hub.rooms[c.hub.users[c.UserID()].Room()]
			var i = 0
			for _, user := range room.participants {
				if slices.Contains(room.admins, user.UserID) {
					continue
				}
				c.hub.MessageUser(c.UserID(), user.UserID, newposition+newPositions[i%len(newPositions)])
				i = i + 1
			}
		}
	case subMatch[1] == "kick":
		if c.hub.users[c.UserID()].IsInRoom() {
			roomID := c.hub.users[c.UserID()].Room()
			if c.hub.rooms[roomID].IsAdmin(c.UserID()) {
				c.hub.MessageRoom(roomID, userleft+subMatch[3])
				err := c.hub.rooms[roomID].Leave(subMatch[3])
				if err != nil {
					c.send <- valueobjects.RPC_NACK.ExportWith(err.Error())
					break
				}
				for _, user := range c.hub.users {
					if user.Color == subMatch[3] && user.Room() == roomID {
						user.SetColor("")
						user.SetRoom("")
					}
				}
			}
		}
	case subMatch[1] == "claim":
		if c.hub.users[c.UserID()].IsInRoom() {
			roomID := c.hub.users[c.UserID()].Room()
			c.hub.rooms[roomID].SetTopic(subMatch[9])
			c.hub.MessageRoom(roomID, command)
		}
	case subMatch[1] == "voicechat":
		user := c.hub.users[c.UserID()]
		if user.IsInRoom() {
			user.SetLastVoiceId(subMatch[9])
			roomID := c.hub.users[c.UserID()].Room()
			c.hub.MessageRoom(roomID, command)

			for _, participant := range c.hub.rooms[roomID].participants {
				if participant.LastVoiceId() != "" && participant.UserID != c.UserID() {
					c.send <- []byte("voicechat " + participant.Color + " " + participant.LastVoiceId())

					if participant.MicrophoneEnabled() {
						c.send <- []byte("microphoneunmute " + participant.Color)
					} else {
						c.send <- []byte("microphonemute " + participant.Color)
					}
				}
			}
		}
	case subMatch[1] == "microphoneunmute":
		user := c.hub.users[c.UserID()]
		if user.IsInRoom() {
			user.SetMicrophoneEnabled(true)
			roomID := c.hub.users[c.UserID()].Room()
			c.hub.MessageRoom(roomID, command)
		}
	case subMatch[1] == "microphonemute":
		user := c.hub.users[c.UserID()]
		if user.IsInRoom() {
			user.SetMicrophoneEnabled(false)
			roomID := c.hub.users[c.UserID()].Room()
			c.hub.MessageRoom(roomID, command)
		}
	default:
		return ErrCommandNotRecognized
	}

	return nil
}
