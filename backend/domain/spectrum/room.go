package spectrum

import (
	"errors"
	"slices"
)

var generalColors = []string{
	"aeaeae", // Neutral gray
	"ff5555", // Bright red
	"cd5334", // Burnt orange
	"ff9955", // Vibrant orange
	"ffe680", // Soft yellow
	"aade87", // Light green
	"4b0082", // Pale teal
	"aaeeff", // Light cyan
	"c6afe9", // Soft lavender
	"d473d4", // Muted mauve
}

type Room struct {
	id           string
	topic        string
	password     string
	closed       bool
	admins       []string
	participants map[string]*User
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

func (r *Room) AddUser(color string, user *User) error {
	if r.closed {
		return errors.New("room closed")
	}

	if !slices.Contains(generalColors, color) {
		return errors.New("unknown color")
	}

	if _, alreadyPresent := r.participants[color]; alreadyPresent {
		return errors.New("color already taken")
	}

	r.participants[color] = user
	return nil
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

func (r *Room) Close() error {
	if r.closed {
		return errors.New("room closed")
	}
	r.closed = true
	return nil
}

func (r *Room) IsClosed() bool {
	return r.closed
}
