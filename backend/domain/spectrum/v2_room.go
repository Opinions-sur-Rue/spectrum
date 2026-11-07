package spectrum

import (
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

type roomJoinPayload struct {
	RoomID string `json:"roomId"`
}

type roomStatePayload struct {
	RoomID        string              `json:"roomId"`
	UserID        string              `json:"userId"`
	Role          Role                `json:"role"`
	Settings      RoomSettings        `json:"settings"`
	Members       []roomMemberPayload `json:"members"`
	Spectrum      spectrumPayload     `json:"spectrum"`
	Voice         voiceStatus         `json:"voice"`
	Transcription transcriptionStatus `json:"transcription"`
}

type roomMemberPayload struct {
	ID           string `json:"id"`
	Nickname     string `json:"nickname"`
	Role         Role   `json:"role"`
	Color        string `json:"color,omitempty"`
	HandRaisedAt int64  `json:"handRaisedAt,omitempty"`
}

func init() {
	v2Handlers["room.create"] = handleRoomCreate
	v2Handlers["room.join"] = handleRoomJoin
	v2Handlers["room.get"] = handleRoomGet
	v2Handlers["room.settings"] = handleRoomSettings
	v2Handlers["room.promote"] = handleRoomPromote
	v2Handlers["room.demote"] = handleRoomDemote
	v2Handlers["room.profile"] = handleRoomProfile
}

func handleRoomCreate(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		spectrumConfiguration
		Topic string `json:"topic"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	payload.Topic = strings.TrimSpace(payload.Topic)
	if !payload.valid() || utf8.RuneCountInString(payload.Topic) > 500 {
		c.v2Error(envelope, "invalid_spectrum_configuration", ErrInvalidSpectrumConfiguration)
		return ErrInvalidSpectrumConfiguration
	}
	user := c.hub.GetUser(c.userID)
	if c.userID == "" || user == nil {
		c.v2Error(envelope, "not_signed_in", ErrNotSignedIn)
		return ErrNotSignedIn
	}
	if user.IsInRoom() {
		return handleRoomGet(c, envelope)
	}
	roomID, color, err := c.hub.NewRoomWithCode(c.userID, 12)
	if err != nil {
		c.v2Error(envelope, "room_create_failed", err)
		return err
	}
	user.SetRoom(roomID)
	user.SetColor(color)
	_ = c.hub.WithRoom(roomID, func(room *Room) error {
		room.configureSpectrum(payload.spectrumConfiguration)
		room.SetTopic(payload.Topic)
		// Keep legacy rooms at eight slots; v2 defaults to six.
		if slots, overridden := envInt("SPECTRUM_PARTICIPANT_SLOTS"); !overridden || slots <= 0 {
			settings := room.Settings()
			settings.ParticipantSlots = 6
			room.SetSettings(settings)
		}
		return nil
	})
	return handleRoomGet(c, envelope)
}

func handleRoomJoin(c *Client, envelope *valueobjects.Envelope) error {
	var payload roomJoinPayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	user := c.hub.GetUser(c.userID)
	if c.userID == "" || user == nil {
		c.v2Error(envelope, "not_signed_in", ErrNotSignedIn)
		return ErrNotSignedIn
	}
	if user.IsInRoom() && user.Room() != payload.RoomID {
		c.v2Error(envelope, "already_in_room", ErrForbidden)
		return ErrForbidden
	}
	if err := c.hub.JoinSpectator(payload.RoomID, c.userID); err != nil {
		c.v2Error(envelope, "room_join_failed", err)
		return err
	}
	c.hub.MessageRoomV2(payload.RoomID, "room.invalidate", struct{}{}, nil)
	return handleRoomGet(c, envelope)
}

func handleRoomGet(c *Client, envelope *valueobjects.Envelope) error {
	user, roomID, role, settings, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	state := roomStatePayload{RoomID: roomID, Role: role, Settings: settings}
	var present bool
	c.hub.WithRoomRead(roomID, func(room *Room) {
		state.Role, present = room.RoleOf(user.UserID)
		if !present {
			return
		}
		state.Settings = room.Settings()
		state.UserID = room.memberIDs[user.UserID]
		for _, member := range append(room.Participants(), room.Spectators()...) {
			memberRole, _ := room.RoleOf(member.UserID)
			publicID := room.memberIDs[member.UserID]
			state.Members = append(state.Members, roomMemberPayload{ID: publicID, Nickname: room.memberName(member), Role: memberRole, Color: member.Color, HandRaisedAt: room.raisedHands[member.UserID]})
		}
		state.Spectrum = room.spectrumFor(user.UserID, state.Role)
		state.Voice = voiceStatus{Available: c.hub.voiceEnabled && c.hub.voiceBackend != nil && c.hub.voiceError == nil, Generation: room.voiceGeneration}
		state.Transcription = transcriptionStatus{Available: c.hub.transcriptionConfigured(), Ready: time.Since(c.hub.transcriptionHeartbeat) < 5*time.Second}
		state.Transcription.Mode = transcriptionModeServer
		if browserTranscriptionEnabled() {
			state.Transcription.Mode = transcriptionModeBrowser
			state.Transcription.Ready = state.Transcription.Available
			for id, session := range room.browserTranscripts {
				role, present := room.RoleOf(session.owner.userID)
				if present && role.CanPublishVoice() && session.generation == room.voiceGeneration && time.Since(session.seen) < 15*time.Second {
					state.Transcription.Speakers = append(state.Transcription.Speakers, id)
				}
			}
		}
	})
	if !present {
		c.v2Error(envelope, "not_in_room", ErrNotInRoom)
		return ErrNotInRoom
	}
	sort.Slice(state.Members, func(i, j int) bool { return state.Members[i].ID < state.Members[j].ID })
	c.SendV2("room.state", state)
	if err := handleCanvasGet(c, envelope); err != nil {
		return err
	}
	return handleLiveGet(c, envelope)
}

func (r *Room) memberName(member *User) string {
	if member.Nickname != "" {
		return member.Nickname
	}
	suffix := strings.TrimPrefix(r.memberIDs[member.UserID], "m_")
	if len(suffix) > 4 {
		suffix = suffix[:4]
	}
	return "Guest " + suffix
}

func handleRoomPromote(c *Client, envelope *valueobjects.Envelope) error {
	return changeStage(c, envelope, true)
}

func handleRoomDemote(c *Client, envelope *valueobjects.Envelope) error {
	return changeStage(c, envelope, false)
}

func changeStage(c *Client, envelope *valueobjects.Envelope, promote bool) error {
	var payload struct {
		MemberID string `json:"memberId"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	validate := func(room *Room) error {
		if !room.IsAdmin(c.userID) {
			return ErrForbidden
		}
		target, present := room.userIDForMember(payload.MemberID)
		if !present || target == c.userID || room.IsAdmin(target) {
			return ErrForbidden
		}
		if promote {
			if _, onBench := room.spectators[target]; !onBench {
				return ErrUserNotOnBench
			}
			if len(room.participants) >= room.ParticipantSlots() {
				return ErrRoomFull
			}
		} else {
			if _, onStage := room.ColorOf(target); !onStage {
				return ErrUserNotOnStage
			}
			if len(room.spectators) >= room.SpectatorLimit() {
				return ErrSpectatorLimitReached
			}
		}
		return nil
	}
	err = c.hub.voiceMutation(roomID, !promote, validate, func(room *Room) error {
		target, _ := room.userIDForMember(payload.MemberID)
		if promote {
			_, err := room.Promote(target)
			return err
		}
		return room.Demote(target)
	})
	if err != nil {
		c.v2Error(envelope, "stage_change_failed", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}

func handleRoomProfile(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		Nickname string `json:"nickname"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	payload.Nickname = strings.TrimSpace(payload.Nickname)
	if utf8.RuneCountInString(payload.Nickname) > 40 {
		c.v2Error(envelope, "invalid_nickname", ErrForbidden)
		return ErrForbidden
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		if _, present := room.RoleOf(c.userID); !present {
			return ErrForbidden
		}
		c.hub.users[c.userID].SetNickname(payload.Nickname)
		room.spectrumRevision++
		return nil
	})
	if err != nil {
		c.v2Error(envelope, "invalid_profile", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}

func handleRoomSettings(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		NotesVisibleToSpectators   *bool   `json:"notesVisibleToSpectators"`
		PelletsVisibleToSpectators *bool   `json:"pelletsVisibleToSpectators"`
		PelletsHidden              *bool   `json:"pelletsHidden"`
		SpectatorChatEnabled       *bool   `json:"spectatorChatEnabled"`
		TranscriptionEnabled       *bool   `json:"transcriptionEnabled"`
		TranscriptionLanguage      *string `json:"transcriptionLanguage"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	err = c.hub.voiceMutation(roomID, payload.TranscriptionEnabled != nil || payload.TranscriptionLanguage != nil, func(room *Room) error {
		if !room.IsAdmin(c.userID) {
			return ErrForbidden
		}
		if payload.TranscriptionLanguage != nil && !validTranscriptionLanguage(*payload.TranscriptionLanguage) {
			return ErrTranscriptContent
		}
		if payload.TranscriptionEnabled != nil && *payload.TranscriptionEnabled && !c.hub.transcriptionConfigured() {
			return ErrTranscriptDisabled
		}
		return nil
	}, func(room *Room) error {
		settings := room.Settings()
		if payload.SpectatorChatEnabled != nil {
			settings.SpectatorChatEnabled = *payload.SpectatorChatEnabled
		}
		if payload.TranscriptionEnabled != nil {
			settings.TranscriptionEnabled = *payload.TranscriptionEnabled
		}
		if payload.TranscriptionLanguage != nil {
			settings.TranscriptionLanguage = *payload.TranscriptionLanguage
		}
		if payload.NotesVisibleToSpectators != nil {
			settings.NotesVisibleToSpectators = *payload.NotesVisibleToSpectators
		}
		if payload.PelletsVisibleToSpectators != nil {
			settings.PelletsVisibleToSpectators = *payload.PelletsVisibleToSpectators
		}
		if payload.PelletsHidden != nil {
			room.participantsHidden = *payload.PelletsHidden
		}
		room.SetSettings(settings)
		return nil
	})
	if err != nil {
		c.v2Error(envelope, "forbidden", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}
