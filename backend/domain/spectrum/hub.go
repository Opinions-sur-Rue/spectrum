package spectrum

import (
	"context"
	"errors"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	"Opinions-sur-Rue/spectrum/utils"

	log "github.com/sirupsen/logrus"
)

// Hub maintains the set of active clients with their business entity logic plus the entities associating clients together: Players with Battleships Matches, Participants with Spectrum Rooms, etc.
type Hub struct {
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
}

var (
	ErrRoomNotFound          = errors.New("room not found")
	ErrRoomClosed            = errors.New("room already closed")
	ErrWrongRoomOrPassword   = errors.New("wrong room or password")
	ErrUnknownAtRoomCreation = errors.New("unknown problem at room creation")
	ErrUserCannotJoin        = errors.New("user cannot join room")
)

func NewHub() *Hub {
	return &Hub{
		messages:              make(chan *valueobjects.Message),
		Register:              make(chan *Client),
		unregister:            make(chan *Client),
		clients:               make(map[*Client]bool),
		users:                 make(map[string]*User),
		mappingUserIDToClient: make(map[string]*Client),
		rooms:                 make(map[string]*Room),
	}
}

func (h *Hub) CountOnlineUsers() int {
	return len(h.users)
}

func (h *Hub) CountTotalRooms() int {
	return len(h.rooms)
}

func (h *Hub) CountActiveRooms() int {
	var count = 0
	for _, room := range h.rooms {
		if !room.IsClosed() {
			count = count + 1
		}
	}
	return count
}

func (h *Hub) LinkUserWithClient(userID string, client *Client) {
	if _, ok := h.users[userID]; !ok {
		user := NewUser(userID)
		h.users[userID] = user
	}

	h.mappingUserIDToClient[userID] = client
}

func (h *Hub) NewRoom(creatorUserID string, creatorColor string) (string, error) {
	roomID := utils.GenerateRandomString(4)

	room := NewRoom(h.users[creatorUserID], roomID, "")

	err := room.AddUser(creatorColor, h.users[creatorUserID])
	if err != nil {
		return "", ErrUnknownAtRoomCreation
	}

	h.rooms[roomID] = room

	return roomID, nil
}

func (h *Hub) NewPrivateRoom(creatorUserID string, creatorColor string) (string, string, error) {
	roomID, err := h.NewRoom(creatorUserID, creatorColor)
	if err != nil {
		return "", "", ErrUnknownAtRoomCreation
	}
	password := utils.GenerateRandomString(12)

	err = h.rooms[roomID].SetPassword(password)
	if err != nil {
		return "", "", errors.New("unknown problem at room locking")
	}

	return roomID, password, nil
}

func (h *Hub) JoinRoom(roomID string, userID string, color string) error {
	var room *Room
	if r, ok := h.rooms[roomID]; !ok {
		return ErrRoomNotFound
	} else {
		room = r
	}

	if room.IsClosed() {
		return ErrRoomClosed
	}

	user := h.users[userID]

	if err := room.AddUser(color, user); err != nil {
		return errors.Join(err, ErrUserCannotJoin)
	}

	user.SetRoom(roomID)

	userNickname := user.Nickname
	if userNickname == "" {
		userNickname = userID
	}

	h.MessageRoom(roomID, "joined "+userNickname)

	return nil
}

func (h *Hub) JoinPrivateRoom(roomID string, userID string, password string, color string) error {
	room := h.rooms[roomID]

	if password != room.password {
		return ErrWrongRoomOrPassword
	}

	return h.JoinRoom(roomID, userID, color)
}

func (h *Hub) Broadcast(senderID string, content string) {
	h.messages <- valueobjects.NewBroadcastMessage(senderID, []byte(content))
}

func (h *Hub) MessageUser(senderID string, recipentID string, content string) {
	h.messages <- valueobjects.NewMessage(senderID, recipentID, []byte(content))
}

func (h *Hub) MessageRoom(roomID string, content string) {
	for _, user := range h.rooms[roomID].participants {
		h.messages <- valueobjects.NewServiceMessage(user.UserID, []byte(content))
	}
}

func (h *Hub) Run(ctx context.Context) {
	go h.Routine(ctx)

	log.Debug("Hub runner starting...")
	for {
		select {
		case client := <-h.Register:
			h.clients[client] = true
			log.WithFields(log.Fields{
				"connectionsOpened": len(h.clients),
			}).Debug("New client connected")
		case client := <-h.unregister:
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
		case message := <-h.messages:
			if message.IsBroadcastMessage() {
				for client := range h.clients {
					(*client).Send(message.Content())
				}
			} else {
				if client, ok := h.mappingUserIDToClient[message.Recipient()]; ok {
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
			// Cleaning routine
			log.Debug("Cleaning routine")
			for roomID, room := range h.rooms {
				log.WithFields(log.Fields{
					"roomID": roomID,
				}).Debug("Checking room")
				if room.IsClosed() {
					continue
				}
				if len(room.participants) == 0 {
					room.Close()
					continue
				}

				participantsDeleted := make([]string, 0, len(room.participants))
				participantsToNotify := make([]string, 0, len(room.participants))
				for i, participant := range room.participants {
					log.WithFields(log.Fields{
						"color": i,
					}).Debug("Checking user")
					if participant.beginningGracePeriod+20 < time.Now().Unix() {
						log.WithFields(log.Fields{
							"color": i,
							"grace": participant.beginningGracePeriod,
							"now":   time.Now().Unix(),
						}).Debug("Removing user")

						participant.SetRoom("")
						delete(room.participants, i)
						participantsDeleted = append(participantsDeleted, i)
					} else {
						participantsToNotify = append(participantsToNotify, participant.UserID)
					}
				}
				for _, participantToNotify := range participantsToNotify {
					for _, participantDeleted := range participantsDeleted {
						h.MessageUser(participantToNotify, participantToNotify, "userleft "+participantDeleted)
					}
				}
			}
		}
	}
}
