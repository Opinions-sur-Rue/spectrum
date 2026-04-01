package spectrum

import (
	"context"
	"errors"
	"os"
	"strconv"
	"sync"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	"Opinions-sur-Rue/spectrum/utils"
	log "github.com/sirupsen/logrus"
)

// Hub maintains the set of active clients with their business entity logic plus the entities associating clients together: Players with Battleships Matches, Participants with Spectrum Rooms, etc.
type Hub struct {
	// mu protects clients, users, mappingUserIDToClient, and rooms from concurrent access.
	// Use RLock/RUnlock for reads, Lock/Unlock for writes.
	mu sync.RWMutex

	// Registered clients.
	clients map[*Client]bool

	users map[string]*User

	mappingUserIDToClient map[string]*Client

	rooms map[string]*Room

	messages chan *valueobjects.Message

	// Register requests from the clients.
	Register chan *Client

	// Unregister requests from clients.
	unregister chan *Client

	context context.Context

	// gracePeriodSeconds is how long a disconnected participant is kept in a room
	// before being evicted. Configurable via SPECTRUM_GRACE_PERIOD_SECONDS (default: 60).
	gracePeriodSeconds int64
}

var (
	ErrRoomNotFound          = errors.New("room not found")
	ErrRoomClosed            = errors.New("room already closed")
	ErrWrongRoomOrPassword   = errors.New("wrong room or password")
	ErrUnknownAtRoomCreation = errors.New("unknown problem at room creation")
	ErrUserCannotJoin        = errors.New("user cannot join room")
)

func NewHub() *Hub {
	gracePeriod := int64(60)
	if envVal := os.Getenv("SPECTRUM_GRACE_PERIOD_SECONDS"); envVal != "" {
		if parsed, err := strconv.ParseInt(envVal, 10, 64); err == nil && parsed > 0 {
			gracePeriod = parsed
		}
	}
	return &Hub{
		messages:              make(chan *valueobjects.Message, 256),
		Register:              make(chan *Client),
		unregister:            make(chan *Client),
		clients:               make(map[*Client]bool),
		users:                 make(map[string]*User),
		mappingUserIDToClient: make(map[string]*Client),
		rooms:                 make(map[string]*Room),
		gracePeriodSeconds:    gracePeriod,
	}
}

func (h *Hub) CountOnlineUsers() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.users)
}

func (h *Hub) CountTotalRooms() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.rooms)
}

func (h *Hub) CountActiveRooms() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var count = 0
	for _, room := range h.rooms {
		if !room.IsClosed() {
			count = count + 1
		}
	}
	return count
}

func (h *Hub) LinkUserWithClient(userID string, client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.users[userID]; !ok {
		user := NewUser(userID)
		h.users[userID] = user
	}
	h.mappingUserIDToClient[userID] = client
}

func (h *Hub) NewRoom(creatorUserID string) (string, string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	roomID := utils.GenerateRandomString(4)
	room := NewRoom(h.users[creatorUserID], roomID, "")

	creatorColor, err := room.AddUser(h.users[creatorUserID])
	if err != nil {
		return "", "", ErrUnknownAtRoomCreation
	}

	h.rooms[roomID] = room
	return roomID, creatorColor, nil
}

func (h *Hub) NewPrivateRoom(creatorUserID string) (string, string, string, error) {
	roomID, creatorColor, err := h.NewRoom(creatorUserID)
	if err != nil {
		return "", "", "", ErrUnknownAtRoomCreation
	}
	password := utils.GenerateRandomString(12)

	h.mu.Lock()
	defer h.mu.Unlock()
	err = h.rooms[roomID].SetPassword(password)
	if err != nil {
		return "", "", "", errors.New("unknown problem at room locking")
	}

	return roomID, creatorColor, password, nil
}

func (h *Hub) JoinRoom(roomID string, userID string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[roomID]
	if !ok {
		return "", ErrRoomNotFound
	}

	if room.IsClosed() {
		return "", ErrRoomClosed
	}

	user := h.users[userID]

	color, err := room.AddUser(user)
	if err != nil {
		return "", errors.Join(err, ErrUserCannotJoin)
	}

	user.SetRoom(roomID)

	userNickname := user.Nickname
	if userNickname == "" {
		userNickname = userID
	}

	reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_JOINED, color, userNickname)
	h.messageRoomLocked(roomID, reply)

	return color, nil
}

func (h *Hub) JoinPrivateRoom(roomID string, userID string, password string) (string, error) {
	h.mu.RLock()
	room, ok := h.rooms[roomID]
	if !ok {
		h.mu.RUnlock()
		return "", ErrRoomNotFound
	}
	if password != room.password {
		h.mu.RUnlock()
		return "", ErrWrongRoomOrPassword
	}
	h.mu.RUnlock()

	return h.JoinRoom(roomID, userID)
}

func (h *Hub) Broadcast(senderID string, content *valueobjects.MessageContent) {
	h.messages <- valueobjects.NewBroadcastMessage(senderID, content.Export())
}

func (h *Hub) MessageUser(senderID string, recipentID string, content *valueobjects.MessageContent) {
	h.messages <- valueobjects.NewMessage(senderID, recipentID, content.Export())
}

func (h *Hub) MessageRoom(roomID string, content *valueobjects.MessageContent) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	h.messageRoomLocked(roomID, content)
}

// --- Accessor helpers for use in rpc.go (called from ReadPump goroutines) ---

// GetUser returns the User for a given userID, or nil if not found.
func (h *Hub) GetUser(userID string) *User {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.users[userID]
}

// GetRoom returns the Room for a given roomID, or nil if not found.
func (h *Hub) GetRoom(roomID string) *Room {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.rooms[roomID]
}

// WithRoom executes fn with the room under a write lock, returning an error if the room doesn't exist.
func (h *Hub) WithRoom(roomID string, fn func(room *Room) error) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	room, ok := h.rooms[roomID]
	if !ok {
		return ErrRoomNotFound
	}
	return fn(room)
}

// WithRoomRead executes fn with the room under a read lock.
func (h *Hub) WithRoomRead(roomID string, fn func(room *Room)) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if room, ok := h.rooms[roomID]; ok {
		fn(room)
	}
}

// LeaveRoom removes a participant from a room and reassigns admin if needed.
func (h *Hub) LeaveRoom(roomID string, color string, userID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	room, ok := h.rooms[roomID]
	if !ok {
		return ErrRoomNotFound
	}
	wasAdmin := room.IsAdmin(userID)
	if err := room.Leave(color); err != nil {
		return err
	}
	if wasAdmin {
		room.RemoveAdmin(userID)
		if len(room.admins) == 0 && len(room.participants) > 0 {
			h.reassignAdminLocked(roomID, room)
		}
	}
	return nil
}

// AddRoom adds a new room under a write lock.
func (h *Hub) AddRoom(roomID string, room *Room) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.rooms[roomID] = room
}

// SetUserGracePeriod updates the grace period for a user under a write lock.
func (h *Hub) SetUserGracePeriod(userID string, ts int64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if user, ok := h.users[userID]; ok {
		user.beginningGracePeriod = ts
	}
}

// ClearUserByColor clears the room and color for any user matching a given color in a room.
// Used to clean up state after a kick.
func (h *Hub) ClearUserByColor(roomID string, color string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, u := range h.users {
		if u.Color == color && u.Room() == roomID {
			u.SetColor("")
			u.SetRoom("")
		}
	}
}

// messageRoomLocked sends a message to all participants in a room.
// Caller must hold h.mu (read or write lock).
func (h *Hub) messageRoomLocked(roomID string, content *valueobjects.MessageContent) {
	room, ok := h.rooms[roomID]
	if !ok {
		return
	}
	for _, user := range room.participants {
		h.messages <- valueobjects.NewServiceMessage(user.UserID, content.Export())
	}
}

func (h *Hub) Run(ctx context.Context) {
	h.context = ctx
	go h.Routine(ctx)

	log.Debug("Hub runner starting...")
	for {
		select {
		case client := <-h.Register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.WithFields(log.Fields{
				"connectionsOpened": len(h.clients),
			}).Debug("New client connected")
		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				log.WithFields(log.Fields{
					"player": (*client).UserID(),
				}).Debug("Unregistering client")

				if client.UserID() != "" && h.users[client.UserID()].IsInRoom() {
					h.users[client.UserID()].beginningGracePeriod = time.Now().Unix()
				}
				delete(h.clients, client)
				delete(h.mappingUserIDToClient, client.UserID())
				client.SetUserID("")
			}
			h.mu.Unlock()
		case message := <-h.messages:
			if message.IsBroadcastMessage() {
				h.mu.RLock()
				for client := range h.clients {
					(*client).Send(message.Content())
				}
				h.mu.RUnlock()
			} else {
				h.mu.RLock()
				if client, ok := h.mappingUserIDToClient[message.Recipient()]; ok {
					(*client).Send(message.Content())
				}
				h.mu.RUnlock()
			}
		case <-ctx.Done():
			log.Info("Hub runner terminated...")
			return
		}
	}
}

func (h *Hub) Routine(ctx context.Context) {
	log.Debug("Hub cleaning starting...")
	for {
		select {
		case <-ctx.Done():
			log.Info("Hub runner terminated...")
			return
		case <-time.After(30 * time.Second):
			log.Debug("Cleaning routine")
			h.mu.Lock()
			for roomID, room := range h.rooms {
				h.cleanupRoomLocked(roomID, room)
			}
			h.mu.Unlock()
		}
	}
}

// cleanupRoomLocked processes a single room during the cleanup routine.
// Caller must hold h.mu write lock.
func (h *Hub) cleanupRoomLocked(roomID string, room *Room) {
	log.WithFields(log.Fields{"roomID": roomID}).Debug("Checking room")

	if room.IsClosed() {
		return
	}
	if len(room.participants) == 0 {
		room.Close()
		return
	}

	deleted, toNotify, adminRemoved := h.evictExpiredParticipants(room)

	for _, notifyID := range toNotify {
		for _, color := range deleted {
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_USERLEFT, color)
			h.messages <- valueobjects.NewMessage(notifyID, notifyID, reply.Export())
		}
	}

	if adminRemoved && len(room.admins) == 0 && len(room.participants) > 0 {
		h.reassignAdminLocked(roomID, room)
	}
}

// evictExpiredParticipants removes participants whose grace period has expired.
// Returns deleted colors, userIDs to notify, and whether an admin was removed.
// Caller must hold h.mu write lock.
func (h *Hub) evictExpiredParticipants(room *Room) (deleted []string, toNotify []string, adminRemoved bool) {
	now := time.Now().Unix()
	for color, participant := range room.participants {
		if participant.beginningGracePeriod+h.gracePeriodSeconds < now {
			log.WithFields(log.Fields{
				"color": color,
				"grace": participant.beginningGracePeriod,
				"now":   now,
			}).Debug("Removing user")

			if room.IsAdmin(participant.UserID) {
				room.RemoveAdmin(participant.UserID)
				adminRemoved = true
			}
			participant.SetRoom("")
			delete(room.participants, color)
			deleted = append(deleted, color)
		} else {
			toNotify = append(toNotify, participant.UserID)
		}
	}
	return
}

// reassignAdminLocked picks the first remaining participant and promotes them to admin.
// Caller must hold h.mu write lock.
func (h *Hub) reassignAdminLocked(roomID string, room *Room) {
	for color, participant := range room.participants {
		if err := room.SetAdmin(participant); err == nil {
			log.WithFields(log.Fields{
				"roomID": roomID,
				"color":  color,
				"userID": participant.UserID,
			}).Info("Admin reassigned")
			reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_MADEADMIN, color)
			h.messageRoomLocked(roomID, reply)
		}
		return
	}
}
