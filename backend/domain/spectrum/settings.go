package spectrum

import (
	"os"
	"strconv"
)

const (
	transcriptionLanguageAuto = "auto"
	// DefaultParticipantSlots is the legacy maximum number of pellets.
	// v2 rooms created by the frontend set 6 explicitly.
	DefaultParticipantSlots = 8

	// DefaultSpectatorLimit bounds the bench independently of the stage.
	DefaultSpectatorLimit = 50

	// DefaultTranscriptSegments bounds the in-memory transcript ring buffer.
	DefaultTranscriptSegments = 5000
)

// RoomSettings holds the per-room feature flags introduced in v2.
// The zero value is not valid: use DefaultRoomSettings.
type RoomSettings struct {
	// ParticipantSlots is the number of users that can be on stage at once.
	ParticipantSlots int `json:"participantSlots"`

	// SpectatorLimit is the number of users that can watch the room.
	SpectatorLimit int `json:"spectatorLimit"`

	// SpectatorChatEnabled lets spectators write in the chat.
	SpectatorChatEnabled bool `json:"spectatorChatEnabled"`

	// PelletsVisibleToSpectators exposes participant positions to the bench.
	PelletsVisibleToSpectators bool `json:"pelletsVisibleToSpectators"`

	// NotesVisibleToSpectators exposes revealed canvas notes to the bench.
	NotesVisibleToSpectators bool `json:"notesVisibleToSpectators"`

	// TranscriptionEnabled turns the speech-to-text pipeline on for the room.
	TranscriptionEnabled bool `json:"transcriptionEnabled"`
	// TranscriptionLanguage pins recognition instead of redetecting short clips.
	TranscriptionLanguage string `json:"transcriptionLanguage"`
}

// DefaultRoomSettings returns the v2 defaults, before environment overrides.
func DefaultRoomSettings() RoomSettings {
	return RoomSettings{
		ParticipantSlots:           DefaultParticipantSlots,
		SpectatorLimit:             DefaultSpectatorLimit,
		SpectatorChatEnabled:       false,
		PelletsVisibleToSpectators: true,
		NotesVisibleToSpectators:   false,
		TranscriptionEnabled:       true,
		TranscriptionLanguage:      "fr",
	}
}

// LoadRoomSettings returns the defaults with deployment-level overrides
// applied from the environment. Invalid values are ignored.
func LoadRoomSettings() RoomSettings {
	settings := DefaultRoomSettings()

	if v, ok := envInt("SPECTRUM_PARTICIPANT_SLOTS"); ok && v > 0 {
		settings.ParticipantSlots = v
	}
	if v, ok := envInt("SPECTRUM_SPECTATOR_LIMIT"); ok && v > 0 {
		settings.SpectatorLimit = v
	}
	if v, ok := envBool("SPECTRUM_SPECTATOR_CHAT"); ok {
		settings.SpectatorChatEnabled = v
	}
	if v, ok := envBool("SPECTRUM_TRANSCRIPTION_ENABLED"); ok {
		settings.TranscriptionEnabled = v
	}

	return settings
}

// Sanitize clamps the settings into a usable range. Called when a client
// supplies a partial settings payload.
func (s RoomSettings) Sanitize() RoomSettings {
	if s.ParticipantSlots <= 0 || s.ParticipantSlots > len(generalColors) {
		s.ParticipantSlots = DefaultParticipantSlots
	}
	if s.SpectatorLimit <= 0 {
		s.SpectatorLimit = DefaultSpectatorLimit
	}
	if !validTranscriptionLanguage(s.TranscriptionLanguage) {
		s.TranscriptionLanguage = "fr"
	}
	return s
}

func validTranscriptionLanguage(language string) bool {
	return language == "fr" || language == "en" || language == transcriptionLanguageAuto
}

func envInt(key string) (int, bool) {
	raw := os.Getenv(key)
	if raw == "" {
		return 0, false
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, false
	}
	return value, true
}

func envBool(key string) (bool, bool) {
	raw := os.Getenv(key)
	if raw == "" {
		return false, false
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, false
	}
	return value, true
}
