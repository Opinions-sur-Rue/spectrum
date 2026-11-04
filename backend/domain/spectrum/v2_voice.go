package spectrum

import (
	"context"
	"crypto/rand"
	"errors"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	voicedomain "Opinions-sur-Rue/spectrum/domain/voice"
)

type voiceStatus struct {
	Available  bool   `json:"available"`
	Generation uint64 `json:"generation"`
}

type voiceCredentials struct {
	RoomID     string `json:"roomId"`
	RequestID  string `json:"requestId"`
	URL        string `json:"url"`
	Token      string `json:"token"`
	CanPublish bool   `json:"canPublish"`
	Generation uint64 `json:"generation"`
}

func init() { v2Handlers["voice.join"] = handleVoiceJoin }

// Physical rooms are retired before a role or membership is revoked. Since SFU
// auto-creation is disabled, cached/refreshed publisher tokens cannot recreate
// those rooms. Other listeners reconnect; microphones never resume automatically.
func (h *Hub) voiceMutation(roomID string, revoke bool, validate, mutate func(*Room) error) error {
	h.voiceMu.Lock()
	h.mu.RLock()
	room, present := h.rooms[roomID]
	if !present {
		h.mu.RUnlock()
		h.voiceMu.Unlock()
		return ErrRoomNotFound
	}
	err := validate(room)
	oldVoiceRoom := room.voiceRoomID
	h.mu.RUnlock()
	if err != nil {
		h.voiceMu.Unlock()
		return err
	}
	retired := revoke && oldVoiceRoom != ""
	if retired {
		if h.voiceBackend == nil {
			h.voiceMu.Unlock()
			return voicedomain.ErrUnavailable
		}
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		err = h.voiceBackend.DeleteRoom(ctx, oldVoiceRoom)
		cancel()
		if err != nil {
			h.voiceMu.Unlock()
			return voicedomain.ErrUnavailable
		}
	}
	h.mu.Lock()
	if h.rooms[roomID] != room {
		err = ErrRoomNotFound
	} else {
		if retired {
			room.voiceRoomID = ""
			room.voiceGeneration++
			room.spectrumRevision++
		}
		if err = validate(room); err == nil {
			err = mutate(room)
		}
	}
	h.mu.Unlock()
	h.voiceMu.Unlock()
	if retired {
		h.MessageRoomV2(roomID, "voice.invalidate", struct{}{}, nil)
	}
	return err
}

func handleVoiceJoin(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		RequestID string `json:"requestId"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "voice_invalid_request", voicedomain.ErrUnavailable)
		return err
	}
	if len(payload.RequestID) > 64 {
		c.v2Error(envelope, "voice_invalid_request", voicedomain.ErrUnavailable)
		return voicedomain.ErrUnavailable
	}
	envelope.ID = payload.RequestID
	credentials, err := c.issueVoiceCredentials()
	if err != nil {
		code := "voice_unavailable"
		if errors.Is(err, ErrNotInRoom) || errors.Is(err, ErrNotSignedIn) || errors.Is(err, ErrRoomNotFound) {
			code = "voice_not_in_room"
		}
		c.v2Error(envelope, code, voicedomain.ErrUnavailable)
		return err
	}
	credentials.RequestID = payload.RequestID
	c.SendV2("voice.credentials", credentials)
	return nil
}

func (c *Client) issueVoiceCredentials() (voiceCredentials, error) {
	h := c.hub
	if !h.voiceEnabled || h.voiceBackend == nil || h.voiceError != nil {
		return voiceCredentials{}, voicedomain.ErrUnavailable
	}
	h.voiceMu.Lock()
	defer h.voiceMu.Unlock()
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		return voiceCredentials{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := h.voiceBackend.Prepare(ctx); err != nil {
		return voiceCredentials{}, err
	}
	var physical, identity string
	var publish bool
	var generation uint64
	err = h.WithRoom(roomID, func(room *Room) error {
		role, member := room.RoleOf(c.userID)
		if !member || room.IsClosed() {
			return ErrNotInRoom
		}
		physical, identity, publish, generation = room.voiceRoomID, room.memberIDs[c.userID], role.CanPublishVoice(), room.voiceGeneration
		return nil
	})
	if err != nil {
		return voiceCredentials{}, err
	}
	if physical == "" {
		physical = voicedomain.Namespace + rand.Text()
	}
	if err := h.voiceBackend.CreateRoom(ctx, physical); err != nil {
		return voiceCredentials{}, err
	}
	err = h.WithRoom(roomID, func(room *Room) error {
		role, member := room.RoleOf(c.userID)
		if !member || room.IsClosed() {
			return ErrNotInRoom
		}
		room.voiceRoomID = physical
		publish = role.CanPublishVoice()
		return nil
	})
	if err != nil {
		_ = h.voiceBackend.DeleteRoom(ctx, physical)
		return voiceCredentials{}, err
	}
	token, err := h.voiceBackend.JoinToken(physical, identity, publish)
	if err != nil {
		return voiceCredentials{}, err
	}
	return voiceCredentials{RoomID: roomID, URL: h.voiceBackend.PublicURL(), Token: token, CanPublish: publish, Generation: generation}, nil
}

func (h *Hub) prepareVoice(ctx context.Context) {
	if h.voiceBackend == nil {
		return
	}
	h.voiceMu.Lock()
	defer h.voiceMu.Unlock()
	prepare, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = h.voiceBackend.Prepare(prepare)
}

func (h *Hub) shutdownVoice() {
	if h.voiceBackend == nil {
		return
	}
	h.voiceMu.Lock()
	defer h.voiceMu.Unlock()
	h.mu.RLock()
	var rooms []string
	for _, room := range h.rooms {
		if room.voiceRoomID != "" {
			rooms = append(rooms, room.voiceRoomID)
		}
	}
	h.mu.RUnlock()
	for _, room := range rooms {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = h.voiceBackend.DeleteRoom(ctx, room)
		cancel()
	}
}
