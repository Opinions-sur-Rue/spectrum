package spectrum

import "testing"

func TestDefaultRoomSettings(t *testing.T) {
	settings := DefaultRoomSettings()

	if settings.ParticipantSlots != DefaultParticipantSlots {
		t.Fatalf("ParticipantSlots = %d, want %d", settings.ParticipantSlots, DefaultParticipantSlots)
	}
	if settings.SpectatorLimit != DefaultSpectatorLimit {
		t.Fatalf("SpectatorLimit = %d, want %d", settings.SpectatorLimit, DefaultSpectatorLimit)
	}
	if settings.SpectatorChatEnabled {
		t.Fatal("spectator chat must be disabled by default")
	}
	if !settings.PelletsVisibleToSpectators {
		t.Fatal("pellets must be visible to spectators by default")
	}
	if settings.NotesVisibleToSpectators {
		t.Fatal("notes must be hidden from spectators by default")
	}
	if !settings.TranscriptionEnabled {
		t.Fatal("transcription must be enabled by default")
	}
	if settings.TranscriptionLanguage != "fr" {
		t.Fatal("transcription language must default to French")
	}
}

func TestLoadRoomSettingsEnvOverrides(t *testing.T) {
	t.Setenv("SPECTRUM_PARTICIPANT_SLOTS", "6")
	t.Setenv("SPECTRUM_SPECTATOR_LIMIT", "12")
	t.Setenv("SPECTRUM_SPECTATOR_CHAT", "true")
	t.Setenv("SPECTRUM_TRANSCRIPTION_ENABLED", "false")

	settings := LoadRoomSettings()

	if settings.ParticipantSlots != 6 {
		t.Fatalf("ParticipantSlots = %d, want 6", settings.ParticipantSlots)
	}
	if settings.SpectatorLimit != 12 {
		t.Fatalf("SpectatorLimit = %d, want 12", settings.SpectatorLimit)
	}
	if !settings.SpectatorChatEnabled {
		t.Fatal("SpectatorChatEnabled should be true")
	}
	if settings.TranscriptionEnabled {
		t.Fatal("TranscriptionEnabled should be false")
	}
}

func TestLoadRoomSettingsIgnoresInvalidEnv(t *testing.T) {
	t.Setenv("SPECTRUM_PARTICIPANT_SLOTS", "nope")
	t.Setenv("SPECTRUM_SPECTATOR_LIMIT", "-4")
	t.Setenv("SPECTRUM_SPECTATOR_CHAT", "maybe")

	settings := LoadRoomSettings()
	defaults := DefaultRoomSettings()

	if settings.ParticipantSlots != defaults.ParticipantSlots {
		t.Fatalf("ParticipantSlots = %d, want %d", settings.ParticipantSlots, defaults.ParticipantSlots)
	}
	if settings.SpectatorLimit != defaults.SpectatorLimit {
		t.Fatalf("SpectatorLimit = %d, want %d", settings.SpectatorLimit, defaults.SpectatorLimit)
	}
	if settings.SpectatorChatEnabled != defaults.SpectatorChatEnabled {
		t.Fatalf("SpectatorChatEnabled = %v, want %v", settings.SpectatorChatEnabled, defaults.SpectatorChatEnabled)
	}
}

func TestRoomSettingsSanitize(t *testing.T) {
	settings := RoomSettings{
		ParticipantSlots: 99,
		SpectatorLimit:   0,
	}.Sanitize()

	if settings.ParticipantSlots != DefaultParticipantSlots {
		t.Fatalf("ParticipantSlots = %d, want %d", settings.ParticipantSlots, DefaultParticipantSlots)
	}
	if settings.SpectatorLimit != DefaultSpectatorLimit {
		t.Fatalf("SpectatorLimit = %d, want %d", settings.SpectatorLimit, DefaultSpectatorLimit)
	}
}
