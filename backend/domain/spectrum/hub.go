package spectrum

import (
	"context"
	"errors"
	"os"
	"strconv"
	"sync"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	voicedomain "Opinions-sur-Rue/spectrum/domain/voice"
	"Opinions-sur-Rue/spectrum/utils"
	log "github.com/sirupsen/logrus"
)

// Hub maintains the set of active clients with their business entity logic plus the entities associating clients together: Players with Battleships Matches, Participants with Spectrum Rooms, etc.
type Hub struct {
	// mu protects clients, users, mappingUserIDToClient, and rooms from concurrent access.
	// Use RLock/RUnlock for reads, Lock/Unlock for writes.
	mu sync.RWMutex
	// Lock order: voiceMu, then mu. SFU HTTP calls never hold mu.
	voiceMu      sync.Mutex
	voiceBackend voicedomain.Backend
	voiceEnabled bool
	voiceError   error

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
	ErrRoomFull              = errors.New("room is full")
	ErrSpectatorLimitReached = errors.New("spectator limit reached")
	ErrUserNotOnBench        = errors.New("user is not a spectator")
	ErrUserNotOnStage        = errors.New("user is not a participant")
	ErrNotAdmin              = errors.New("user is not an admin")
)

func NewHub() *Hub {
	voiceBackend, voiceError := voicedomain.FromEnv()
	voiceEnabled := os.Getenv("SPECTRUM_VOICE_ENABLED") == "true"
	if !voiceEnabled && os.Getenv("LIVEKIT_API_SECRET") != "" {
		voiceBackend, _ = voicedomain.ConfiguredFromEnv()
	}
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
		voiceBackend:          voiceBackend,
		voiceEnabled:          voiceEnabled,
		voiceError:            voiceError,
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
	return h.newRoom(creatorUserID, 4)
}

// NewRoomWithCode creates a room whose identifier is long enough to resist
// guessing. v2 uses it because an uninvited guest could otherwise join an
// ephemeral room and listen to its voice room.
func (h *Hub) NewRoomWithCode(creatorUserID string, codeLength int) (string, string, error) {
	if codeLength < 4 || codeLength > 64 {
		return "", "", ErrUnknownAtRoomCreation
	}
	return h.newRoom(creatorUserID, codeLength)
}

func (h *Hub) newRoom(creatorUserID string, codeLength int) (string, string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	creator := h.users[creatorUserID]
	if creator == nil {
		return "", "", ErrUnknownAtRoomCreation
	}
	var roomID string
	for {
		roomID = utils.GenerateRandomString(codeLength)
		if _, taken := h.rooms[roomID]; !taken {
			break
		}
	}
	room := NewRoom(creator, roomID, "")

	creatorColor, err := room.AddUser(creator)
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

	room, ok := h.rooms[roomID]
	if !ok {
		h.mu.Unlock()
		return "", ErrRoomNotFound
	}

	if room.IsClosed() {
		h.mu.Unlock()
		return "", ErrRoomClosed
	}

	user := h.users[userID]
	if user == nil {
		h.mu.Unlock()
		return "", ErrUserCannotJoin
	}

	color, err := room.AddUser(user)
	if err != nil {
		h.mu.Unlock()
		return "", errors.Join(err, ErrUserCannotJoin)
	}

	user.SetRoom(roomID)

	userNickname := room.memberName(user)
	h.mu.Unlock()

	reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_JOINED, color, userNickname)
	h.MessageRoom(roomID, reply)

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
	var recipients []string
	if room := h.rooms[roomID]; room != nil {
		for _, member := range append(room.Participants(), room.Spectators()...) {
			recipients = append(recipients, member.UserID)
		}
	}
	h.mu.RUnlock()
	raw := content.Export()
	for _, userID := range recipients {
		h.messages <- valueobjects.NewServiceMessage(userID, raw)
	}
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
	var notice *valueobjects.MessageContent
	err := h.voiceMutation(roomID, true, func(room *Room) error {
		if _, present := room.RoleOf(userID); !present {
			return ErrUserCannotJoin
		}
		return nil
	}, func(room *Room) error {
		wasAdmin := room.IsAdmin(userID)
		if actual, onStage := room.ColorOf(userID); onStage {
			if err := room.Leave(actual); err != nil {
				return err
			}
		}
		room.RemoveSpectator(userID)
		if user := h.users[userID]; user != nil {
			user.SetRoom("")
			user.SetColor("")
			user.SetMicrophoneEnabled(false)
			user.SetLastVoiceId("")
		}
		if wasAdmin {
			room.RemoveAdmin(userID)
			if len(room.admins) == 0 && len(room.participants) > 0 {
				notice = h.reassignAdminLocked(roomID, room)
			}
		}
		return nil
	})
	if err == nil {
		if notice != nil {
			h.MessageRoom(roomID, notice)
		}
		h.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	}
	return err
}

// KickByColor retires voice admission before removing the selected participant.
func (h *Hub) KickByColor(roomID, requester, color string) error {
	var target string
	var notice *valueobjects.MessageContent
	err := h.voiceMutation(roomID, true, func(room *Room) error {
		if !room.IsAdmin(requester) {
			return ErrNotAdmin
		}
		member := room.participants[color]
		if member == nil || member.UserID == requester {
			return ErrUserCannotJoin
		}
		target = member.UserID
		return nil
	}, func(room *Room) error {
		wasAdmin := room.IsAdmin(target)
		if err := room.Leave(color); err != nil {
			return err
		}
		room.RemoveAdmin(target)
		if member := h.users[target]; member != nil {
			member.SetRoom("")
			member.SetColor("")
			member.SetMicrophoneEnabled(false)
			member.SetLastVoiceId("")
		}
		if wasAdmin && len(room.admins) == 0 && len(room.participants) > 0 {
			notice = h.reassignAdminLocked(roomID, room)
		}
		return nil
	})
	if err != nil {
		return err
	}
	h.MessageUser(requester, target, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_STOPPED))
	h.MessageRoom(roomID, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_USERLEFT, color))
	if notice != nil {
		h.MessageRoom(roomID, notice)
	}
	h.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}

// JoinSpectator puts a user on the bench of a room.
func (h *Hub) JoinSpectator(roomID string, userID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[roomID]
	if !ok {
		return ErrRoomNotFound
	}
	if room.IsClosed() {
		return ErrRoomClosed
	}

	user, ok := h.users[userID]
	if !ok || user == nil {
		return ErrUserCannotJoin
	}

	return room.AddSpectator(user)
}

// Promote moves a spectator onto the stage. requesterID must be an admin of
// the room. Returns the pellet color assigned to the promoted user.
func (h *Hub) Promote(roomID string, requesterID string, targetID string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, ok := h.rooms[roomID]
	if !ok {
		return "", ErrRoomNotFound
	}
	if !room.IsAdmin(requesterID) {
		return "", ErrNotAdmin
	}

	color, err := room.Promote(targetID)
	if err != nil {
		return "", err
	}

	if user, ok := h.users[targetID]; ok {
		user.SetRoom(roomID)
	}

	return color, nil
}

// Demote sends a participant back to the bench. requesterID must be an admin
// of the room. The admin cannot demote themselves while other admins remain:
// they can, but the room keeps at least one admin through reassignment.
func (h *Hub) Demote(roomID string, requesterID string, targetID string) error {
	var notice *valueobjects.MessageContent
	err := h.voiceMutation(roomID, true, func(room *Room) error {
		if !room.IsAdmin(requesterID) {
			return ErrNotAdmin
		}
		if _, present := room.ColorOf(targetID); !present {
			return ErrUserNotOnStage
		}
		if len(room.spectators) >= room.SpectatorLimit() {
			return ErrSpectatorLimitReached
		}
		return nil
	}, func(room *Room) error {
		wasAdmin := room.IsAdmin(targetID)
		if err := room.Demote(targetID); err != nil {
			return err
		}
		if wasAdmin && len(room.admins) == 0 && len(room.participants) > 0 {
			notice = h.reassignAdminLocked(roomID, room)
		}
		return nil
	})
	if err == nil {
		if notice != nil {
			h.MessageRoom(roomID, notice)
		}
		h.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	}
	return err
}

// StopRoom broadcasts RPC_STOPPED to all participants and deletes the room.
func (h *Hub) StopRoom(roomID string) error {
	var recipients []string
	err := h.voiceMutation(roomID, true, func(room *Room) error { return nil }, func(room *Room) error {
		for _, member := range append(room.Participants(), room.Spectators()...) {
			recipients = append(recipients, member.UserID)
			member.SetRoom("")
			member.SetColor("")
			member.SetMicrophoneEnabled(false)
			member.SetLastVoiceId("")
		}
		delete(h.rooms, roomID)
		return nil
	})
	if err != nil {
		return err
	}
	content := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_STOPPED).Export()
	for _, userID := range recipients {
		h.messages <- valueobjects.NewServiceMessage(userID, content)
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

// MessageRoomV2 sends a structured v2 event to every room member accepted by
// allow. A nil predicate broadcasts to the whole room.
func (h *Hub) MessageRoomV2(roomID string, op string, payload any, allow func(userID string, role Role) bool) {
	envelope, err := valueobjects.NewEnvelope(op, payload)
	if err != nil {
		log.Errorf("Failed to build v2 room event %s: %v", op, err)
		return
	}
	raw := envelope.Export()
	if raw == nil {
		return
	}

	h.mu.RLock()
	room, ok := h.rooms[roomID]
	if !ok {
		h.mu.RUnlock()
		return
	}

	// Collect recipients under the lock, then send after releasing it.
	// Sending on h.messages while holding h.mu can deadlock: the buffer is
	// bounded, and the Hub.Run consumer needs the same lock to route.
	recipients := make([]string, 0, room.MemberCount())

	collect := func(userID string) {
		role, _ := room.RoleOf(userID)
		if allow == nil || allow(userID, role) {
			recipients = append(recipients, userID)
		}
	}

	for _, participant := range room.participants {
		collect(participant.UserID)
	}
	for _, spectator := range room.spectators {
		collect(spectator.UserID)
	}
	h.mu.RUnlock()

	for _, userID := range recipients {
		h.messages <- valueobjects.NewServiceMessage(userID, raw)
	}
}

func (h *Hub) Run(ctx context.Context) {
	h.context = ctx
	go h.prepareVoice(ctx)
	defer h.shutdownVoice()
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
				clients := make([]*Client, 0, len(h.clients))
				for client := range h.clients {
					clients = append(clients, client)
				}
				h.mu.RUnlock()

				// Send outside the lock: a full client channel must not block
				// the single consumer while it holds the hub lock.
				for _, client := range clients {
					(*client).Send(message.Content())
				}
			} else {
				h.mu.RLock()
				client, ok := h.mappingUserIDToClient[message.Recipient()]
				h.mu.RUnlock()

				if ok {
					(*client).Send(message.Content())
				}
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
			h.prepareVoice(ctx)
			h.mu.RLock()
			rooms := make([]string, 0, len(h.rooms))
			for roomID := range h.rooms {
				rooms = append(rooms, roomID)
			}
			h.mu.RUnlock()
			for _, roomID := range rooms {
				h.cleanupRoom(roomID)
			}
		}
	}
}

var errNoCleanup = errors.New("cleanup not needed")

// Eviction uses the same voice retirement barrier as explicit role changes.
func (h *Hub) cleanupRoom(roomID string) {
	var deleted, recipients []string
	var notice *valueobjects.MessageContent
	err := h.voiceMutation(roomID, true, func(room *Room) error {
		if room.IsClosed() {
			return errNoCleanup
		}
		if room.MemberCount() == 0 {
			return nil
		}
		now := time.Now().Unix()
		for _, member := range append(room.Participants(), room.Spectators()...) {
			if member.beginningGracePeriod+h.gracePeriodSeconds < now {
				return nil
			}
		}
		return errNoCleanup
	}, func(room *Room) error {
		var removedAdmin bool
		deleted, recipients, removedAdmin = h.evictExpiredParticipants(room)
		h.evictExpiredSpectators(room)
		if removedAdmin && len(room.admins) == 0 && len(room.participants) > 0 {
			notice = h.reassignAdminLocked(roomID, room)
		}
		if room.MemberCount() == 0 {
			if err := room.Close(); err != nil {
				return err
			}
			delete(h.rooms, roomID)
		}
		return nil
	})
	if err != nil {
		if !errors.Is(err, errNoCleanup) && !errors.Is(err, ErrRoomNotFound) {
			log.Warn("Room cleanup postponed: voice revocation unavailable")
		}
		return
	}
	for _, recipient := range recipients {
		for _, color := range deleted {
			h.MessageUser(recipient, recipient, valueobjects.NewMessageContentWithArgs(valueobjects.RPC_USERLEFT, color))
		}
	}
	if notice != nil {
		h.MessageRoom(roomID, notice)
	}
	h.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
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
			participant.SetColor("")
			participant.SetMicrophoneEnabled(false)
			participant.SetLastVoiceId("")
			delete(room.participants, color)
			room.spectrumRevision++
			deleted = append(deleted, color)
		} else {
			toNotify = append(toNotify, participant.UserID)
		}
	}
	return
}

// evictExpiredSpectators removes bench members whose grace period expired.
// Spectators have no color, so nothing is broadcast for them yet.
// Caller must hold h.mu write lock.
func (h *Hub) evictExpiredSpectators(room *Room) {
	now := time.Now().Unix()
	for userID, spectator := range room.spectators {
		if spectator.beginningGracePeriod+h.gracePeriodSeconds < now {
			delete(room.spectators, userID)
			room.spectrumRevision++
			spectator.SetRoom("")
			spectator.SetColor("")
		}
	}
}

// reassignAdminLocked picks the first remaining participant and promotes them to admin.
// Caller must hold h.mu write lock.
func (h *Hub) reassignAdminLocked(roomID string, room *Room) *valueobjects.MessageContent {
	for color, participant := range room.participants {
		if err := room.SetAdmin(participant); err == nil {
			log.WithFields(log.Fields{
				"roomID": roomID,
				"color":  color,
				"userID": participant.UserID,
			}).Info("Admin reassigned")
			return valueobjects.NewMessageContentWithArgs(valueobjects.RPC_MADEADMIN, color)
		}
		return nil
	}
	return nil
}
