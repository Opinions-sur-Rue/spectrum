package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTranscriptIngestFailsClosed(t *testing.T) {
	for _, test := range []struct {
		name, token, authorization, body string
		status                           int
	}{
		{"disabled", "", "", `{}`, 404},
		{"unauthorized", "fixture-token", "Bearer wrong", `{}`, 401},
		{"missing scheme", "fixture-token", "fixture-token", `{}`, 401},
		{"malformed", "fixture-token", "Bearer fixture-token", `{`, 400},
		{"trailing", "fixture-token", "Bearer fixture-token", `{} {}`, 400},
		{"invalid", "fixture-token", "Bearer fixture-token", `{}`, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("SPECTRUM_TRANSCRIPTION_TOKEN", test.token)
			request := httptest.NewRequest("POST", "/spectrum/transcript", strings.NewReader(test.body))
			request.Header.Set("Authorization", test.authorization)
			response := httptest.NewRecorder()
			TranscriptIngest(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
		})
	}
}
