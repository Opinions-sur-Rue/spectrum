package spectrum

import (
	"os"
	"time"
)

const transcriptionModeBrowser = "browser"
const transcriptionModeServer = "server"

func transcriptionFlagEnabled() bool {
	enabled, _ := envBool("SPECTRUM_TRANSCRIPTION_ENABLED")
	return enabled
}

type transcriptionStatus struct {
	Available bool     `json:"available"`
	Ready     bool     `json:"ready"`
	Mode      string   `json:"mode"`
	Speakers  []string `json:"speakers,omitempty"`
}

// TranscriptAdmission fences delayed STT output against a retired voice room.
type TranscriptAdmission struct {
	VoiceRoomID string `json:"voiceRoomId"`
	Generation  uint64 `json:"generation"`
}

type TranscriptionJob struct {
	RoomID string `json:"roomId"`
	TranscriptAdmission
	Token    string   `json:"token"`
	Speakers []string `json:"speakers"`
	Language string   `json:"language"`
}

// Called under h.mu while holding voiceMu, so consent and grants share one epoch.
func (r *Room) voicePublishAllowed(identity string, onStage, consent, configured bool) bool {
	if !r.settings.TranscriptionEnabled || !configured {
		return onStage
	}
	if consent && onStage {
		if r.transcriptionConsents == nil {
			r.transcriptionConsents = make(map[string]uint64)
		}
		r.transcriptionConsents[identity] = r.voiceGeneration
	}
	generation, accepted := r.transcriptionConsents[identity]
	return onStage && accepted && generation == r.voiceGeneration
}

func (h *Hub) transcriptionConfigured() bool {
	if browserTranscriptionEnabled() {
		return h.voiceEnabled && h.voiceBackend != nil && h.voiceError == nil
	}
	return h.serverTranscriptionConfigured()
}

func browserTranscriptionEnabled() bool {
	return transcriptionFlagEnabled() && os.Getenv("SPECTRUM_TRANSCRIPTION_MODE") == transcriptionModeBrowser
}

func (h *Hub) serverTranscriptionConfigured() bool {
	mode := os.Getenv("SPECTRUM_TRANSCRIPTION_MODE")
	return h.voiceEnabled && h.voiceBackend != nil && h.voiceError == nil &&
		(mode == "" || mode == transcriptionModeServer) &&
		transcriptionFlagEnabled() && os.Getenv("SPECTRUM_TRANSCRIPTION_TOKEN") != ""
}

// TranscriptionJobs is called only by the authenticated worker after its model
// loads. It grants listen-only admission and exposes no private signin IDs.
func (h *Hub) TranscriptionJobs() ([]TranscriptionJob, error) {
	if !h.serverTranscriptionConfigured() {
		return nil, ErrTranscriptDisabled
	}
	h.voiceMu.Lock()
	defer h.voiceMu.Unlock()
	h.mu.Lock()
	h.transcriptionHeartbeat = time.Now()
	jobs := make([]TranscriptionJob, 0)
	for _, room := range h.rooms {
		if room.IsClosed() || !room.settings.TranscriptionEnabled || room.voiceRoomID == "" {
			continue
		}
		job := TranscriptionJob{RoomID: room.id, Language: room.Settings().Sanitize().TranscriptionLanguage, TranscriptAdmission: TranscriptAdmission{VoiceRoomID: room.voiceRoomID, Generation: room.voiceGeneration}}
		for _, participant := range room.participants {
			id := room.memberIDs[participant.UserID]
			generation, consented := room.transcriptionConsents[id]
			if consented && generation == room.voiceGeneration {
				job.Speakers = append(job.Speakers, id)
			}
		}
		// Prepare the listener as soon as audio is joined. It still cannot
		// subscribe to a speaker until explicit consent enters the allowlist.
		jobs = append(jobs, job)
	}
	h.mu.Unlock()
	for index := range jobs {
		token, err := h.voiceBackend.JoinToken(jobs[index].VoiceRoomID, "stt_worker", false)
		if err != nil {
			return nil, err
		}
		jobs[index].Token = token
	}
	return jobs, nil
}

func (h *Hub) AppendWorkerTranscript(admission TranscriptAdmission, roomID, speakerID, segmentID, text string, start, end int64, language string, final bool) (transcriptSegment, error) {
	if !h.serverTranscriptionConfigured() {
		return transcriptSegment{}, ErrTranscriptDisabled
	}
	return h.appendTranscriptFor(&admission, roomID, speakerID, segmentID, text, start, end, language, final, false)
}

// DiscardWorkerTranscript withdraws a provisional caption rejected by final
// recognition. The versioned tombstone prevents stale snapshots reviving it.
func (h *Hub) DiscardWorkerTranscript(admission TranscriptAdmission, roomID, speakerID, segmentID, language string) (transcriptSegment, error) {
	if !h.serverTranscriptionConfigured() {
		return transcriptSegment{}, ErrTranscriptDisabled
	}
	return h.appendTranscriptFor(&admission, roomID, speakerID, segmentID, "", 0, 0, language, true, true)
}
