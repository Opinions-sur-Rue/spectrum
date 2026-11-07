package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"unicode/utf8"

	"Opinions-sur-Rue/spectrum/domain/spectrum"
)

// The STT worker posts finished and partial utterances here. The endpoint is
// disabled unless a token is configured, so a deployment without transcription
// exposes no ingestion surface at all.
type transcriptIngestPayload struct {
	VoiceRoomID string  `json:"voiceRoomId"`
	Generation  *uint64 `json:"generation"`
	RoomID      string  `json:"roomId"`
	SegmentID   string  `json:"segmentId"`
	SpeakerID   string  `json:"speakerId"`
	Text        string  `json:"text"`
	Start       int64   `json:"start"`
	End         int64   `json:"end"`
	Language    string  `json:"language"`
	Final       *bool   `json:"final"`
	Discarded   bool    `json:"discarded"`
}

// @Summary		Ingest a transcript segment from the local STT worker
// @Description	Internal endpoint, authenticated with SPECTRUM_TRANSCRIPTION_TOKEN
// @Tags			spectrum
// @Accept			json
// @Success		204
// @Router			/spectrum/transcript [post]
func TranscriptIngest(w http.ResponseWriter, r *http.Request) {
	token := os.Getenv("SPECTRUM_TRANSCRIPTION_TOKEN")
	if token == "" {
		http.NotFound(w, r)
		return
	}
	provided, bearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !bearer || subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var payload transcriptIngestPayload
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
	if err := decoder.Decode(&payload); err != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}
	text := strings.TrimSpace(payload.Text)
	final := true
	if payload.Final != nil {
		final = *payload.Final
	}
	if !payload.validContent(text, final) {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}
	hub := getSpectrumHub()
	if hub == nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	admission := spectrum.TranscriptAdmission{VoiceRoomID: payload.VoiceRoomID, Generation: *payload.Generation}
	var err error
	if payload.Discarded {
		_, err = hub.DiscardWorkerTranscript(admission, payload.RoomID, payload.SpeakerID, payload.SegmentID, payload.Language)
	} else {
		_, err = hub.AppendWorkerTranscript(admission, payload.RoomID, payload.SpeakerID, payload.SegmentID, text, payload.Start, payload.End, payload.Language, final)
	}
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, spectrum.ErrRoomNotFound), errors.Is(err, spectrum.ErrNotInRoom):
		http.Error(w, "room not found", http.StatusNotFound)
	case errors.Is(err, spectrum.ErrTranscriptDisabled):
		http.Error(w, "transcription disabled", http.StatusConflict)
	case errors.Is(err, spectrum.ErrTranscriptSpeaker):
		http.Error(w, "speaker not on stage", http.StatusForbidden)
	default:
		http.Error(w, "invalid segment", http.StatusBadRequest)
	}
}

func (p transcriptIngestPayload) validContent(text string, final bool) bool {
	if p.RoomID == "" || p.VoiceRoomID == "" || p.Generation == nil || !strings.HasPrefix(p.SpeakerID, "m_") || len(p.SegmentID) > 64 || utf8.RuneCountInString(text) > spectrum.TranscriptTextLimit {
		return false
	}
	if p.Discarded {
		return text == "" && final && p.SegmentID != ""
	}
	return text != ""
}

func TranscriptionJobs(w http.ResponseWriter, r *http.Request) {
	token := os.Getenv("SPECTRUM_TRANSCRIPTION_TOKEN")
	if token == "" {
		http.NotFound(w, r)
		return
	}
	provided, bearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !bearer || subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	hub := getSpectrumHub()
	if hub == nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	jobs, err := hub.TranscriptionJobs()
	if err != nil {
		http.Error(w, "transcription unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(jobs)
}
