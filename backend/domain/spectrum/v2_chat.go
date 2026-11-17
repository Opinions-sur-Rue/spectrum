package spectrum

import (
	"errors"
	"slices"
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
var ErrChatChannel = errors.New("unknown chat channel")

// ChatChannel groups messages by audience. Each channel is a separate history,
// so a busy stage conversation cannot evict the room's shared one.
type ChatChannel string

const (
	ChatRoom  ChatChannel = "room"
	ChatStage ChatChannel = "stage"
	ChatAdmin ChatChannel = "admin"
)

var chatChannels = []ChatChannel{ChatRoom, ChatStage, ChatAdmin}

func validChatChannel(channel ChatChannel) bool {
	return slices.Contains(chatChannels, channel)
}

// canSeeChat reports the read audience. Membership in a channel is never
// inferred from message counts: the payload only ever carries visible channels.
func (r Role) canSeeChat(channel ChatChannel) bool {
	switch channel {
	case ChatRoom:
		return true
	case ChatStage:
		return r.OnStage()
	default:
		return r == RoleAdmin
	}
}

// canWriteChat reports the write audience. The room channel keeps the existing
// spectator setting; the stage and admin channels follow the role itself.
func (r Role) canWriteChat(settings RoomSettings, channel ChatChannel) bool {
	switch channel {
	case ChatRoom:
		return r.CanChat(settings)
	case ChatStage:
		return r.OnStage()
	default:
		return r == RoleAdmin
	}
}

type chatMessage struct {
	RoomID    string      `json:"roomId"`
	ID        uint64      `json:"id"`
	Channel   ChatChannel `json:"channel"`
	MemberID  string      `json:"memberId"`
	Nickname  string      `json:"nickname"`
	Color     string      `json:"color,omitempty"`
	Text      string      `json:"text"`
	ClientID  string      `json:"clientId,omitempty"`
	CreatedAt time.Time   `json:"createdAt"`
	Removed   bool        `json:"removed,omitempty"`
}

type chatSnapshot struct {
	RoomID   string        `json:"roomId"`
	Sequence uint64        `json:"sequence"`
	Messages []chatMessage `json:"messages"`
}

type chatRemovePayload struct {
	RoomID    string `json:"roomId"`
	MessageID uint64 `json:"messageId"`
}

func init() {
	v2Handlers["chat.get"] = handleChatGet
	v2Handlers["chat.send"] = handleChatSend
	v2Handlers["chat.remove"] = handleChatRemove
}

// chatAudience accepts every member allowed to read one channel.
func chatAudience(channel ChatChannel) func(userID string, role Role) bool {
	return func(_ string, role Role) bool {
		return role.canSeeChat(channel)
	}
}

func handleChatGet(c *Client, envelope *valueobjects.Envelope) error {
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "chat_not_in_room", err)
		return err
	}
	var snapshot chatSnapshot
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		role, present := room.RoleOf(c.userID)
		if !present || room.IsClosed() {
			return ErrNotInRoom
		}
		snapshot = room.chatSnapshotFor(role)
		return nil
	})
	if err != nil {
		c.v2Error(envelope, "chat_not_in_room", err)
		return err
	}
	c.SendV2("chat.snapshot", snapshot)
	return nil
}

// chatSnapshotFor returns one member's readable history. Removed messages keep
// their identity but never their text.
func (r *Room) chatSnapshotFor(role Role) chatSnapshot {
	snapshot := chatSnapshot{RoomID: r.id, Sequence: r.chatSequence, Messages: []chatMessage{}}
	for _, channel := range chatChannels {
		if !role.canSeeChat(channel) {
			continue
		}
		snapshot.Messages = append(snapshot.Messages, r.chatMessages[channel]...)
	}
	slices.SortFunc(snapshot.Messages, func(a, b chatMessage) int { return int(a.ID - b.ID) })
	return snapshot
}

// Called under the hub write lock: permissions, cooldown and append are atomic.
func (r *Room) appendChat(user *User, channel ChatChannel, text, clientID string, now time.Time) (chatMessage, bool, error) {
	role, present := r.RoleOf(user.UserID)
	if r.IsClosed() || !present {
		return chatMessage{}, false, ErrForbidden
	}
	if !validChatChannel(channel) {
		return chatMessage{}, false, ErrChatChannel
	}
	if !role.canWriteChat(r.Settings(), channel) {
		return chatMessage{}, false, ErrForbidden
	}
	memberID := r.memberIDs[user.UserID]
	history := r.chatMessages[channel]
	for index := len(history) - 1; index >= 0; index-- {
		if history[index].MemberID == memberID && clientID != "" && history[index].ClientID == clientID {
			return history[index], true, nil
		}
	}
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > ChatMessageLimit || len(clientID) > 64 {
		return chatMessage{}, false, ErrChatContent
	}
	// One cooldown per member across channels: switching channels is not a
	// way to bypass the send rate.
	if last, sent := r.chatLastSent[memberID]; sent && now.Sub(last) < chatCooldown {
		return chatMessage{}, false, ErrChatRateLimit
	}
	r.chatSequence++
	message := chatMessage{RoomID: r.id, ID: r.chatSequence, Channel: channel, MemberID: memberID, Nickname: r.memberName(user), Color: user.Color, Text: text, ClientID: clientID, CreatedAt: now.UTC()}
	if r.chatMessages == nil {
		r.chatMessages = make(map[ChatChannel][]chatMessage)
	}
	if r.chatLastSent == nil {
		r.chatLastSent = make(map[string]time.Time)
	}
	r.chatLastSent[memberID] = now.UTC()
	history = append(r.chatMessages[channel], message)
	if len(history) > ChatHistoryLimit {
		history = history[len(history)-ChatHistoryLimit:]
	}
	r.chatMessages[channel] = history
	return message, false, nil
}

func handleChatSend(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		Text     string      `json:"text"`
		ClientID string      `json:"clientId"`
		Channel  ChatChannel `json:"channel"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "chat_invalid_payload", err)
		return err
	}
	if payload.Channel == "" {
		payload.Channel = ChatRoom
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
		message, duplicate, err = room.appendChat(user, payload.Channel, payload.Text, payload.ClientID, time.Now())
		return err
	})
	if err != nil {
		c.v2Error(envelope, "chat_rejected", err)
		return err
	}
	if duplicate {
		c.SendV2("chat.message", message)
	} else {
		c.hub.MessageRoomV2(roomID, "chat.message", message, chatAudience(message.Channel))
		if message.Channel == ChatRoom {
			// Preserve v1 chat in rooms where the two frontends coexist. Stage and
			// administration conversations never reach v1.
			c.hub.MessageRoom(roomID, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_CHATMESSAGE, message.Color, message.Text))
		}
	}
	return nil
}

// handleChatRemove masks one message: the entry stays in history so the
// conversation does not silently shift, while its text is dropped server-side
// and can never be re-read by any client.
func handleChatRemove(c *Client, envelope *valueobjects.Envelope) error {
	var payload chatRemovePayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "chat_invalid_payload", err)
		return err
	}
	_, roomID, role, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "chat_not_in_room", err)
		return err
	}
	if !role.CanModerate() {
		err = ErrForbidden
		c.v2Error(envelope, "chat_forbidden", err)
		return err
	}
	var message chatMessage
	var found bool
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		for _, channel := range chatChannels {
			for index, existing := range room.chatMessages[channel] {
				if existing.ID != payload.MessageID {
					continue
				}
				if !role.canSeeChat(channel) {
					return ErrForbidden
				}
				if existing.Removed {
					message = existing
					found = true
					return nil
				}
				existing.Text = ""
				existing.ClientID = ""
				existing.Removed = true
				room.chatMessages[channel][index] = existing
				message = existing
				found = true
				return nil
			}
		}
		return nil
	})
	if err != nil {
		c.v2Error(envelope, "chat_rejected", err)
		return err
	}
	if !found {
		c.v2Error(envelope, "chat_not_found", ErrChatContent)
		return ErrChatContent
	}
	removed := chatRemovePayload{RoomID: roomID, MessageID: message.ID}
	c.hub.MessageRoomV2(roomID, "chat.removed", removed, chatAudience(message.Channel))
	return nil
}
