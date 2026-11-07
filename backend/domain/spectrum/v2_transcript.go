package spectrum

import (
	"crypto/rand"
	"errors"
	"strings"
	"unicode/utf8"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

const (
	// TranscriptTextLimit bounds one utterance, in runes.
	TranscriptTextLimit = 4000
	// TranscriptPageLimit bounds one snapshot response.
	TranscriptPageLimit   = 500
	transcriptDefaultPage = 200
)

var (
	ErrTranscriptDisabled = errors.New("transcription is disabled for this room")
	ErrTranscriptSpeaker  = errors.New("speaker is not on stage")
	ErrTranscriptContent  = errors.New("invalid transcript segment")
)

// transcriptSegment is one utterance. Partial results share an ID and replace
// the previous version, so the UI can render live text without duplicates.
type transcriptSegment struct {
	RoomID      string `json:"roomId"`
	ID          string `json:"id"`
	Sequence    uint64 `json:"sequence"`
	SpeakerID   string `json:"speakerId"`
	SpeakerName string `json:"speakerName"`
	Text        string `json:"text"`
	Start       int64  `json:"start"`
	End         int64  `json:"end"`
	Language    string `json:"language"`
	Final       bool   `json:"final"`
	Discarded   bool   `json:"discarded,omitempty"`
	Source      string `json:"source,omitempty"`
}

type transcriptSnapshot struct {
	RoomID   string              `json:"roomId"`
	Enabled  bool                `json:"enabled"`
	Sequence uint64              `json:"sequence"`
	Segments []transcriptSegment `json:"segments"`
}

func init() { v2Handlers["transcript.get"] = handleTranscriptGet }

func handleTranscriptGet(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		After uint64 `json:"after"`
		Limit int    `json:"limit"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "transcript_invalid_request", err)
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "transcript_not_in_room", err)
		return err
	}
	var snapshot transcriptSnapshot
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		if _, present := room.RoleOf(c.userID); !present || room.IsClosed() {
			return ErrNotInRoom
		}
		snapshot = room.transcriptSnapshot(payload.After, payload.Limit)
		return nil
	})
	if err != nil {
		c.v2Error(envelope, "transcript_not_in_room", err)
		return err
	}
	c.SendV2("transcript.snapshot", snapshot)
	return nil
}

func (r *Room) transcriptSnapshot(after uint64, limit int) transcriptSnapshot {
	if limit <= 0 || limit > TranscriptPageLimit {
		limit = transcriptDefaultPage
	}
	snapshot := transcriptSnapshot{RoomID: r.id, Enabled: r.settings.TranscriptionEnabled, Sequence: r.transcriptSequence}
	for _, segment := range r.transcript {
		if after > 0 && segment.Sequence <= after {
			continue
		}
		snapshot.Segments = append(snapshot.Segments, segment)
	}
	if len(snapshot.Segments) > limit {
		snapshot.Segments = snapshot.Segments[len(snapshot.Segments)-limit:]
	}
	return snapshot
}

// appendTranscript stores a final or partial utterance. Caller holds h.mu.
func (r *Room) appendTranscript(segment transcriptSegment) (transcriptSegment, bool, error) {
	if r == nil || r.IsClosed() {
		return transcriptSegment{}, false, ErrRoomClosed
	}
	if !r.settings.TranscriptionEnabled {
		return transcriptSegment{}, false, ErrTranscriptDisabled
	}
	segment.Text = strings.TrimSpace(segment.Text)
	if !segment.validContent() {
		return transcriptSegment{}, false, ErrTranscriptContent
	}
	if segment.ID == "" {
		segment.ID = "t_" + rand.Text()
	}
	for index, existing := range r.transcript {
		if existing.ID == segment.ID {
			if existing.SpeakerID != segment.SpeakerID || (existing.Final && (!segment.Final || segment.Discarded)) {
				return transcriptSegment{}, false, ErrTranscriptContent
			}
			if existing.Discarded {
				return transcriptSegment{}, false, ErrTranscriptContent
			}
			r.transcriptSequence++
			segment.Sequence = r.transcriptSequence
			segment.SpeakerID = existing.SpeakerID
			segment.SpeakerName = existing.SpeakerName
			if segment.Discarded {
				segment.Start, segment.End = existing.Start, existing.End
			}
			r.transcript[index] = segment
			return segment, false, nil
		}
	}
	if segment.Discarded {
		return transcriptSegment{}, false, ErrTranscriptContent
	}
	r.transcriptSequence++
	segment.Sequence = r.transcriptSequence
	if len(r.transcript) == DefaultTranscriptSegments {
		copy(r.transcript, r.transcript[1:])
		r.transcript[len(r.transcript)-1] = segment
	} else {
		r.transcript = append(r.transcript, segment)
	}
	return segment, true, nil
}

func (s transcriptSegment) validContent() bool {
	if len(s.ID) > 64 || utf8.RuneCountInString(s.Text) > TranscriptTextLimit || s.End < s.Start || s.Start < 0 {
		return false
	}
	if s.Language != "" && s.Language != "fr" && s.Language != "en" {
		return false
	}
	if s.Discarded {
		return s.Text == "" && s.Final && s.ID != ""
	}
	return s.Text != ""
}

// AppendTranscript is the ingestion boundary for the self-hosted STT worker.
// The worker authenticates over HTTP and only identifies speakers by public
// member ID, so private signin identities never leave the backend.
func (h *Hub) AppendTranscript(roomID, speakerID, segmentID, text string, start, end int64, language string, final bool) (transcriptSegment, error) {
	return h.appendTranscriptFor(nil, roomID, speakerID, segmentID, text, start, end, language, final, false)
}

func (h *Hub) appendTranscriptFor(admission *TranscriptAdmission, roomID, speakerID, segmentID, text string, start, end int64, language string, final, discarded bool) (transcriptSegment, error) {
	var segment transcriptSegment
	err := h.WithRoom(roomID, func(room *Room) error {
		if admission != nil {
			generation, consented := room.transcriptionConsents[speakerID]
			if admission.VoiceRoomID == "" || room.voiceRoomID != admission.VoiceRoomID || room.voiceGeneration != admission.Generation || !consented || generation != room.voiceGeneration {
				return ErrTranscriptSpeaker
			}
			if pinned := room.Settings().Sanitize().TranscriptionLanguage; pinned != transcriptionLanguageAuto && language != pinned {
				return ErrTranscriptContent
			}
		}
		var speaker *User
		for _, participant := range room.participants {
			if room.memberIDs[participant.UserID] == speakerID {
				speaker = participant
				break
			}
		}
		if speaker == nil {
			return ErrTranscriptSpeaker
		}
		role, present := room.RoleOf(speaker.UserID)
		if !present || !role.CanPublishVoice() {
			return ErrTranscriptSpeaker
		}
		stored, _, err := room.appendTranscript(transcriptSegment{
			RoomID:      room.id,
			ID:          segmentID,
			SpeakerID:   speakerID,
			SpeakerName: room.memberName(speaker),
			Text:        text,
			Start:       start,
			End:         end,
			Language:    language,
			Final:       final,
			Discarded:   discarded,
		})
		segment = stored
		return err
	})
	if err != nil {
		return transcriptSegment{}, err
	}
	h.MessageRoomV2(roomID, "transcript.segment", segment, nil)
	return segment, nil
}
