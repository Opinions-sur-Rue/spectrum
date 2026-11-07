package spectrum

import (
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

var ErrInvalidPosition = errors.New("invalid spectrum position")
var ErrInvalidSpectrumConfiguration = errors.New("spectrum must have 3, 5, 7 or 9 slices")

type spectrumConfiguration struct {
	SliceCount        *int  `json:"sliceCount"`
	ShowNeutralCircle *bool `json:"showNeutralCircle"`
}

func (p spectrumConfiguration) valid() bool {
	return p.SliceCount == nil || *p.SliceCount == 3 || *p.SliceCount == 5 || *p.SliceCount == 7 || *p.SliceCount == 9
}

func (r *Room) configureSpectrum(p spectrumConfiguration) {
	if p.SliceCount != nil {
		r.sliceCount = *p.SliceCount
	}
	if p.ShowNeutralCircle != nil {
		r.showNeutralCircle = *p.ShowNeutralCircle
	}
}

type pelletPayload struct {
	MemberID string  `json:"memberId"`
	Nickname string  `json:"nickname"`
	Color    string  `json:"color"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Version  uint64  `json:"version"`
}

type spectrumPayload struct {
	Revision          uint64          `json:"revision"`
	Topic             string          `json:"topic"`
	SliceCount        int             `json:"sliceCount"`
	ShowNeutralCircle bool            `json:"showNeutralCircle"`
	Hidden            bool            `json:"hidden"`
	Pellets           []pelletPayload `json:"pellets"`
}

func init() {
	v2Handlers["spectrum.get"] = handleSpectrumGet
	v2Handlers["spectrum.move"] = handleSpectrumMove
	v2Handlers["spectrum.topic"] = handleSpectrumTopic
	v2Handlers["spectrum.reset"] = handleSpectrumReset
	v2Handlers["spectrum.configure"] = handleSpectrumConfigure
}

func (r *Room) spectrumFor(userID string, role Role) spectrumPayload {
	state := spectrumPayload{Revision: r.spectrumRevision, Topic: r.Topic(), SliceCount: r.SliceCount(), ShowNeutralCircle: r.ShowNeutralCircle(), Hidden: r.participantsHidden, Pellets: []pelletPayload{}}
	for _, member := range r.Participants() {
		own := member.UserID == userID
		if role != RoleAdmin && !own && (r.participantsHidden || (role == RoleSpectator && !r.settings.PelletsVisibleToSpectators)) {
			continue
		}
		x, y := spectrumPosition(member)
		state.Pellets = append(state.Pellets, pelletPayload{MemberID: r.memberIDs[member.UserID], Nickname: r.memberName(member), Color: member.Color, X: x, Y: y, Version: member.positionVersion})
	}
	if role == RoleAdmin || (!r.participantsHidden && (role != RoleSpectator || r.settings.PelletsVisibleToSpectators)) {
		state.Pellets = append(state.Pellets, r.livePellets()...)
	}
	return state
}

func spectrumPosition(user *User) (float64, float64) {
	parts := strings.Split(user.LastPosition(), ",")
	if len(parts) == 2 {
		x, errX := strconv.ParseFloat(parts[0], 64)
		y, errY := strconv.ParseFloat(parts[1], 64)
		if errX == nil && errY == nil && finitePosition(x, y) {
			return clampSpectrumPosition(x, y)
		}
	}
	for index, color := range generalColors {
		if color == user.Color {
			return 415 + float64(index%4)*50, 555 + float64(index/4)*50
		}
	}
	return 490, 580
}

func finitePosition(x, y float64) bool {
	return !math.IsNaN(x) && !math.IsNaN(y) && !math.IsInf(x, 0) && !math.IsInf(y, 0)
}

func clampSpectrumPosition(x, y float64) (float64, float64) {
	return math.Max(14, math.Min(966, x)), math.Max(14, math.Min(721, y))
}

func handleSpectrumGet(c *Client, envelope *valueobjects.Envelope) error {
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	var state spectrumPayload
	var member bool
	c.hub.WithRoomRead(roomID, func(room *Room) {
		role, present := room.RoleOf(c.userID)
		member = present
		if member {
			state = room.spectrumFor(c.userID, role)
		}
	})
	if !member {
		c.v2Error(envelope, "not_in_room", ErrNotInRoom)
		return ErrNotInRoom
	}
	c.SendV2("spectrum.snapshot", state)
	return nil
}

type spectrumMovementPayload struct {
	Revision uint64  `json:"revision"`
	MemberID string  `json:"memberId"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Version  uint64  `json:"version"`
}

func handleSpectrumMove(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		X *float64 `json:"x"`
		Y *float64 `json:"y"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	if payload.X == nil || payload.Y == nil || !finitePosition(*payload.X, *payload.Y) {
		c.v2Error(envelope, "invalid_position", ErrInvalidPosition)
		return ErrInvalidPosition
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	var movement spectrumMovementPayload
	var currentRoom *Room
	actorID := c.userID
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		role, present := room.RoleOf(c.userID)
		if !present || !role.CanMovePellet() {
			return ErrForbidden
		}
		x, y := clampSpectrumPosition(*payload.X, *payload.Y)
		c.hub.users[c.userID].SetLastPosition(strconv.FormatFloat(x, 'f', -1, 64) + "," + strconv.FormatFloat(y, 'f', -1, 64))
		currentRoom = room
		movement = spectrumMovementPayload{Revision: room.spectrumRevision, MemberID: room.memberIDs[c.userID], X: x, Y: y, Version: c.hub.users[c.userID].positionVersion}
		return nil
	})
	if err != nil {
		c.v2Error(envelope, "forbidden", err)
		return err
	}
	// Audience is rechecked under the hub read lock when recipients are collected.
	// Never send coordinates to members excluded by a hide/demotion in the meantime.
	c.broadcastSpectrumMovement(roomID, actorID, currentRoom, movement)
	return nil
}

func (c *Client) broadcastSpectrumMovement(roomID, actorID string, currentRoom *Room, movement spectrumMovementPayload) {
	c.hub.MessageRoomV2(roomID, "spectrum.moved", movement, func(userID string, role Role) bool {
		actorRole, present := currentRoom.RoleOf(actorID)
		if !present || !actorRole.OnStage() || currentRoom.spectrumRevision != movement.Revision {
			return false
		}
		return role == RoleAdmin || userID == actorID || (!currentRoom.participantsHidden && (role != RoleSpectator || currentRoom.settings.PelletsVisibleToSpectators))
	})
}

func handleSpectrumTopic(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		Topic string `json:"topic"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	payload.Topic = strings.TrimSpace(payload.Topic)
	if utf8.RuneCountInString(payload.Topic) > 500 {
		c.v2Error(envelope, "invalid_topic", ErrForbidden)
		return ErrForbidden
	}
	return changeSpectrum(c, envelope, func(room *Room) { room.SetTopic(payload.Topic) })
}

func handleSpectrumReset(c *Client, envelope *valueobjects.Envelope) error {
	return changeSpectrum(c, envelope, func(room *Room) {
		for _, member := range room.Participants() {
			member.SetLastPosition("")
		}
	})
}

func handleSpectrumConfigure(c *Client, envelope *valueobjects.Envelope) error {
	var payload spectrumConfiguration
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	if !payload.valid() || (payload.SliceCount == nil && payload.ShowNeutralCircle == nil) {
		c.v2Error(envelope, "invalid_spectrum_configuration", ErrInvalidSpectrumConfiguration)
		return ErrInvalidSpectrumConfiguration
	}
	// Layout changes keep coordinates, but advance the structural revision so
	// pending drags and delayed deltas cannot revive the previous layout.
	return changeSpectrum(c, envelope, func(room *Room) { room.configureSpectrum(payload) })
}

func changeSpectrum(c *Client, envelope *valueobjects.Envelope, update func(*Room)) error {
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		role, present := room.RoleOf(c.userID)
		if !present || role != RoleAdmin {
			return ErrForbidden
		}
		update(room)
		room.spectrumRevision++
		return nil
	})
	if err != nil {
		c.v2Error(envelope, "forbidden", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "spectrum.invalidate", struct{}{}, nil)
	return nil
}
