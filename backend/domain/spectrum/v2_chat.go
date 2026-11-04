package spectrum

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

const ChatHistoryLimit = 100
const ChatMessageLimit = 1000
const chatCooldown = 500 * time.Millisecond

var ErrChatContent = errors.New("message must contain 1–1000 characters")
var ErrChatRateLimit = errors.New("please wait a moment before sending another message")

type chatMessage struct {
	RoomID    string    `json:"roomId"`
	ID        uint64    `json:"id"`
	MemberID  string    `json:"memberId"`
	Nickname  string    `json:"nickname"`
	Color     string    `json:"color,omitempty"`
	Text      string    `json:"text"`
	ClientID  string    `json:"clientId,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type chatSnapshot struct {
	RoomID   string        `json:"roomId"`
	Sequence uint64        `json:"sequence"`
	Messages []chatMessage `json:"messages"`
}

func init() {
	v2Handlers["chat.get"] = handleChatGet
	v2Handlers["chat.send"] = handleChatSend
}

func handleChatGet(c *Client, envelope *valueobjects.Envelope) error {
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "chat_not_in_room", err)
		return err
	}
	var snapshot chatSnapshot
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		if _, present := room.RoleOf(c.userID); !present || room.IsClosed() {
			return ErrNotInRoom
		}
		snapshot = chatSnapshot{RoomID: room.id, Sequence: room.chatSequence, Messages: append([]chatMessage{}, room.chatMessages...)}
		return nil
	})
	if err != nil {
		c.v2Error(envelope, "chat_not_in_room", err)
		return err
	}
	c.SendV2("chat.snapshot", snapshot)
	return nil
}

// Called under the hub write lock: permissions, cooldown and append are atomic.
func (r *Room) appendChat(user *User, text, clientID string, now time.Time) (chatMessage, bool, error) {
	role, present := r.RoleOf(user.UserID)
	if r.IsClosed() || !present || !role.CanChat(r.Settings()) {
		return chatMessage{}, false, ErrForbidden
	}
	memberID := r.memberIDs[user.UserID]
	for index := len(r.chatMessages) - 1; index >= 0; index-- {
		previous := r.chatMessages[index]
		if previous.MemberID != memberID {
			continue
		}
		if clientID != "" && previous.ClientID == clientID {
			return previous, true, nil
		}
	}
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > ChatMessageLimit || len(clientID) > 64 {
		return chatMessage{}, false, ErrChatContent
	}
	for index := len(r.chatMessages) - 1; index >= 0; index-- {
		previous := r.chatMessages[index]
		if previous.MemberID == memberID {
			if now.Sub(previous.CreatedAt) < chatCooldown {
				return chatMessage{}, false, ErrChatRateLimit
			}
			break
		}
	}
	r.chatSequence++
	message := chatMessage{RoomID: r.id, ID: r.chatSequence, MemberID: memberID, Nickname: r.memberName(user), Color: user.Color, Text: text, ClientID: clientID, CreatedAt: now.UTC()}
	if len(r.chatMessages) == ChatHistoryLimit {
		copy(r.chatMessages, r.chatMessages[1:])
		r.chatMessages[len(r.chatMessages)-1] = message
	} else {
		r.chatMessages = append(r.chatMessages, message)
	}
	return message, false, nil
}

func handleChatSend(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		Text     string `json:"text"`
		ClientID string `json:"clientId"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "chat_invalid_payload", err)
		return err
	}
	// Correlate a rejection with the pending draft; this is not an identity token.
	if len(payload.ClientID) <= 64 {
		envelope.ID = payload.ClientID
	}
	user, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "chat_not_in_room", err)
		return err
	}
	var message chatMessage
	var duplicate bool
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		var err error
		message, duplicate, err = room.appendChat(user, payload.Text, payload.ClientID, time.Now())
		return err
	})
	if err != nil {
		c.v2Error(envelope, "chat_rejected", err)
		return err
	}
	if duplicate {
		c.SendV2("chat.message", message)
	} else {
		c.hub.MessageRoomV2(roomID, "chat.message", message, nil)
		// Preserve v1 chat in rooms where the two frontends coexist.
		c.hub.MessageRoom(roomID, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_CHATMESSAGE, message.Color, message.Text))
	}
	return nil
}
