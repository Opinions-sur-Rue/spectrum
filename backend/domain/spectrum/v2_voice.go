package spectrum

import (
	"context"
	"crypto/rand"
	"errors"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	voicedomain "Opinions-sur-Rue/spectrum/domain/voice"
	log "github.com/sirupsen/logrus"
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

const (
	voiceReasonKick   = "kick"
	voiceReasonLeave  = "leave"
	voiceReasonExpire = "expire"
	voiceLogReason    = "reason"
	voiceLogPhysical  = "physical"
)

// Full retirement is reserved for room closure and transcription-policy epochs.
// Membership and stage changes use targeted SFU operations plus admission epochs.
func (h *Hub) voiceMutation(roomID string, revoke bool, reason string, validate, mutate func(*Room) error) error {
	return h.voiceChange(roomID, revoke, reason, nil, nil, validate, mutate)
}

// selectMembers returns application user IDs under the hub read lock. Removal
// and token issuance share the voice barrier; network calls never hold h.mu.
func (h *Hub) voiceRemoval(roomID, reason string, selectMembers func(*Room) []string, validate, mutate func(*Room) error) error {
	return h.voiceChange(roomID, false, reason, selectMembers, nil, validate, mutate)
}

func (h *Hub) voiceStage(roomID string, promote bool, target func(*Room) string, validate, mutate func(*Room) error) error {
	return h.voiceChange(roomID, false, "stage_change", nil, func(room *Room) map[string]bool {
		identity := room.memberIDs[target(room)]
		publish := promote && room.voicePublishAllowed(identity, true, false, h.serverTranscriptionConfigured())
		return map[string]bool{identity: publish}
	}, validate, mutate)
}

func (h *Hub) voiceChange(roomID string, revoke bool, reason string, selectMembers func(*Room) []string, permissions func(*Room) map[string]bool, validate, mutate func(*Room) error) error {
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
	var identities []string
	var publishing map[string]bool
	if err == nil && permissions != nil {
		publishing = permissions(room)
	}
	if err == nil && selectMembers != nil {
		for _, id := range selectMembers(room) {
			if identity := room.memberIDs[id]; identity != "" {
				identities = append(identities, identity)
			}
		}
	}
	// Closing the final membership still retires the room, including cached
	// tokens belonging to spectators whose application session is closing.
	closing := selectMembers != nil && len(identities) == room.MemberCount()
	h.mu.RUnlock()
	if err != nil {
		h.voiceMu.Unlock()
		return err
	}
	retired := (revoke || closing) && oldVoiceRoom != ""
	if err = h.applyVoiceSFU(roomID, oldVoiceRoom, reason, retired, identities, publishing); err != nil {
		h.voiceMu.Unlock()
		return err
	}
	h.mu.Lock()
	if h.rooms[roomID] != room {
		err = ErrRoomNotFound
	} else {
		err = room.commitVoiceChange(retired, identities, publishing, validate, mutate)
	}
	h.mu.Unlock()
	h.voiceMu.Unlock()
	if retired {
		h.MessageRoomV2(roomID, "voice.invalidate", struct{}{}, nil)
	}
	return err
}

// Caller holds voiceMu, never h.mu, throughout external SFU calls.
func (h *Hub) applyVoiceSFU(roomID, physical, reason string, retired bool, identities []string, publishing map[string]bool) error {
	if physical == "" || (!retired && len(identities) == 0 && len(publishing) == 0) {
		return nil
	}
	if h.voiceBackend == nil {
		return voicedomain.ErrUnavailable
	}
	if retired {
		log.WithFields(log.Fields{"roomID": roomID, voiceLogPhysical: physical, voiceLogReason: reason}).Info("Retiring LiveKit room")
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		if err := h.voiceBackend.DeleteRoom(ctx, physical); err != nil {
			return voicedomain.ErrUnavailable
		}
		return nil
	}
	for _, identity := range identities {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		err := h.voiceBackend.RemoveParticipant(ctx, physical, identity)
		cancel()
		if err != nil {
			return voicedomain.ErrUnavailable
		}
		log.WithFields(log.Fields{voiceLogPhysical: physical, "participant": identity, voiceLogReason: reason}).Info("LiveKit participant removed")
	}
	for identity, publish := range publishing {
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		err := h.voiceBackend.SetPublishPermission(ctx, physical, identity, publish)
		cancel()
		if err != nil {
			return voicedomain.ErrUnavailable
		}
		log.WithFields(log.Fields{voiceLogPhysical: physical, "participant": identity, "publish": publish, voiceLogReason: reason}).Info("LiveKit participant permission updated")
	}
	return nil
}

// Caller holds both the voice barrier and hub write lock.
func (r *Room) commitVoiceChange(retired bool, identities []string, publishing map[string]bool, validate, mutate func(*Room) error) error {
	if retired {
		r.voiceRoomID = ""
		r.voiceGeneration++
		r.transcriptionConsents = nil
		r.browserTranscripts = nil
		r.voiceAdmissions = nil
		r.spectrumRevision++
	}
	if err := validate(r); err != nil {
		return err
	}
	if err := mutate(r); err != nil {
		return err
	}
	// Fence delayed STT output without reconnecting unrelated audio participants.
	if retired || len(identities) > 0 || len(publishing) > 0 {
		r.transcriptionRevision++
	}
	clear := func(identity string) {
		r.stopSpeaking(identity, time.Now().UnixMilli())
		delete(r.voiceAdmissions, identity)
		delete(r.transcriptionConsents, identity)
		delete(r.browserTranscripts, identity)
	}
	for _, identity := range identities {
		clear(identity)
	}
	for identity, publish := range publishing {
		if !publish {
			clear(identity)
		}
	}
	return nil
}

func handleVoiceJoin(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		RequestID            string `json:"requestId"`
		TranscriptionConsent bool   `json:"transcriptionConsent"`
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
	credentials, err := c.issueVoiceCredentialsWithConsent(payload.TranscriptionConsent)
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
	return c.issueVoiceCredentialsWithConsent(false)
}

func (c *Client) issueVoiceCredentialsWithConsent(consent bool) (voiceCredentials, error) {
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
	var physical, identity, epoch string
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
		publish = room.voicePublishAllowed(identity, role.CanPublishVoice(), consent, h.serverTranscriptionConfigured())
		if room.voiceAdmissions == nil {
			room.voiceAdmissions = make(map[string]string)
		}
		if room.voiceAdmissions[identity] == "" {
			room.voiceAdmissions[identity] = rand.Text()
		}
		epoch = room.voiceAdmissions[identity]
		return nil
	})
	if err != nil {
		_ = h.voiceBackend.DeleteRoom(ctx, physical)
		return voiceCredentials{}, err
	}
	token, err := h.voiceBackend.JoinToken(physical, identity, publish, epoch)
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
