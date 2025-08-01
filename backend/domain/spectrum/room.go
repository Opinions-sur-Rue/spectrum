package spectrum

import (
	"errors"
	"math/rand"
	"slices"

	"Opinions-sur-Rue/spectrum/domain/social"
	log "github.com/sirupsen/logrus"
)

var generalColors = []string{
	"e5130a",
	"e5783e",
	"e5d450",
	"92e550",
	"51cde2",
	"5950e5",
	"ad50e5",
	"4e4c4e",
}

type Room struct {
	id             string
	topic          string
	password       string
	closed         bool
	admins         []string
	participants   map[string]*User
	socialListener social.ChatListener
}

func (r *Room) Join(newUser *User) error {
	if r.closed {
		return errors.New("room closed")
	}
	newUser.SetRoom(r.password)
	return nil
}

func NewRoom(creator *User, id string, topic string) *Room {
	creator.SetRoom(id)
	return &Room{
		topic:        topic,
		closed:       false,
		admins:       []string{creator.UserID},
		participants: make(map[string]*User),
	}
}

func (r *Room) Leave(color string) error {
	if r == nil || r.closed {
		return errors.New("room closed")
	}

	delete(r.participants, color)

	return nil
}

func (r *Room) RoomID() string {
	return r.id
}

func (r *Room) SetTopic(topic string) {
	r.topic = topic
}

func (r *Room) Topic() string {
	return r.topic
}

func (r *Room) SetPassword(password string) error {
	if r.closed {
		return errors.New("room closed")
	}
	r.password = password
	return nil
}

func (r *Room) AddUser(user *User) (string, error) {
	if r.closed {
		return "", errors.New("room closed")
	}

	// Generate a slice containing colorIndices from 0 to n-1
	colorIndices := make([]int, len(generalColors))
	for i := 0; i < len(generalColors); i++ {
		colorIndices[i] = i
	}

	var color string

	for len(colorIndices) != 0 {
		x := rand.Intn(len(colorIndices))

		if _, alreadyPresent := r.participants[generalColors[x]]; alreadyPresent {
			// color already taken
			colorIndices = append(colorIndices[:x], colorIndices[x+1:]...)
		} else {
			r.participants[generalColors[x]] = user
			color = generalColors[x]
			break
		}
	}

	if color == "" {
		return "", errors.New("room is full")
	}

	return color, nil
}

func (r *Room) SetAdminByColor(color string) error {
	if r.closed {
		return errors.New("room closed")
	}
	if _, ok := r.participants[color]; !ok {
		return errors.New("user not found")
	}

	r.admins = append(r.admins, r.participants[color].UserID)
	r.participants[color].SetLastPosition("")
	return nil
}

func (r *Room) SetAdmin(user *User) error {
	if r.closed {
		return errors.New("room closed")
	}
	r.admins = append(r.admins, user.UserID)
	return nil
}

func (r *Room) IsAdmin(userID string) bool {
	if r.closed {
		return false
	}

	return slices.Contains(r.admins, userID)
}

func (r *Room) Close() error {
	if r.closed {
		return errors.New("room closed")
	}

	r.closed = true

	if r.SocialListener() != nil {
		err := r.SocialListener().Disconnect()
		if err != nil {
			log.Error("could not disconnect room social listener")
		}
		r.socialListener = nil
	}

	return nil
}

func (r *Room) IsClosed() bool {
	return r.closed
}

func (r *Room) SocialListener() social.ChatListener {
	return r.socialListener
}

func (r *Room) SetSocialListener(listener social.ChatListener) {
	r.socialListener = listener
}
