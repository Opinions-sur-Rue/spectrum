package spectrum

import (
	"errors"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

const maxTimerSeconds = 24 * 60 * 60

var errInvalidTimer = errors.New("timer duration must be an integer between 0 and 86400 seconds")

// A deadline, not a ticking goroutine: late joins/reconnects recover the same
// countdown without keeping a task alive after the room has been removed.
type roomTimerState struct {
	Revision        uint64 `json:"revision"`
	DurationSeconds int    `json:"durationSeconds"`
	EndsAt          int64  `json:"endsAt"`
	ServerNow       int64  `json:"serverNow"`
}

func init() { v2Handlers["room.timer"] = handleRoomTimer }

func handleRoomTimer(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		DurationSeconds *int `json:"durationSeconds"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	if payload.DurationSeconds == nil || *payload.DurationSeconds < 0 || *payload.DurationSeconds > maxTimerSeconds {
		c.v2Error(envelope, "invalid_timer", errInvalidTimer)
		return errInvalidTimer
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err == nil {
		err = c.hub.WithRoom(roomID, func(room *Room) error {
			if !room.IsAdmin(c.userID) {
				return ErrForbidden
			}
			room.timer.Revision++
			room.timer.DurationSeconds = *payload.DurationSeconds
			room.timer.EndsAt = 0
			if *payload.DurationSeconds > 0 {
				room.timer.EndsAt = time.Now().Add(time.Duration(*payload.DurationSeconds) * time.Second).UnixMilli()
			}
			room.spectrumRevision++
			return nil
		})
	}
	if err != nil {
		c.v2Error(envelope, "timer_failed", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}
