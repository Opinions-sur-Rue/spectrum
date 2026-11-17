package spectrum

import (
	"strconv"
	"testing"
)

func TestTranscriptionAvailabilityKeepsRoomsOptedOut(t *testing.T) {
	t.Setenv("SPECTRUM_TRANSCRIPTION_AVAILABLE", strconv.FormatBool(true))
	t.Setenv("SPECTRUM_TRANSCRIPTION_ENABLED", strconv.FormatBool(false))
	t.Setenv("SPECTRUM_TRANSCRIPTION_MODE", transcriptionModeBrowser)
	hub, _, actor, room, _ := voiceFixture(t)
	if !hub.transcriptionConfigured() || !browserTranscriptionEnabled() {
		t.Fatal("browser transcription should be available")
	}
	if LoadRoomSettings().TranscriptionEnabled || room.settings.TranscriptionEnabled {
		t.Fatal("availability must not opt rooms into transcription")
	}
	if _, err := hub.TranscriptionJobs(); err != ErrTranscriptDisabled {
		t.Fatal("browser availability must not admit a server worker", err)
	}
	room.settings.TranscriptionEnabled = true
	if id := startBrowserTranscript(t, actor, room); id == "" {
		t.Fatal("room opt-in should allow an individually consented session")
	}
}

func TestTranscriptionAvailabilityOverrideAndLegacyFallback(t *testing.T) {
	const availableEnv = "SPECTRUM_TRANSCRIPTION_AVAILABLE"
	const enabledEnv = "SPECTRUM_TRANSCRIPTION_ENABLED"
	for _, tc := range []struct {
		name      string
		available string
		enabled   string
		want      bool
	}{
		{name: "unset legacy enabled", enabled: strconv.FormatBool(true), want: true},
		{name: "unset legacy disabled", enabled: strconv.FormatBool(false)},
		{name: "explicitly available", available: strconv.FormatBool(true), enabled: strconv.FormatBool(false), want: true},
		{name: "deployment kill switch", available: strconv.FormatBool(false), enabled: strconv.FormatBool(true)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(availableEnv, tc.available)
			t.Setenv(enabledEnv, tc.enabled)
			if got := transcriptionFlagEnabled(); got != tc.want {
				t.Fatalf("availability = %v, want %v", got, tc.want)
			}
		})
	}
}
