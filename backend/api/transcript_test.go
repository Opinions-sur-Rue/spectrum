package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTranscriptIngestFailsClosed(t *testing.T) {
	const token = "fixture-token"
	const authorization = "Bearer " + token
	for _, test := range []struct {
		name, token, authorization, body string
		status                           int
	}{
		{"disabled", "", "", `{}`, 404},
		{"unauthorized", token, "Bearer wrong", `{}`, 401},
		{"missing scheme", token, token, `{}`, 401},
		{"malformed", token, authorization, `{`, 400},
		{"trailing", token, authorization, `{} {}`, 400},
		{"invalid", token, authorization, `{}`, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("SPECTRUM_TRANSCRIPTION_TOKEN", test.token)
			request := httptest.NewRequestWithContext(t.Context(), "POST", "/spectrum/transcript", strings.NewReader(test.body))
			request.Header.Set("Authorization", test.authorization)
			response := httptest.NewRecorder()
			TranscriptIngest(response, request)
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
		})
	}
}
