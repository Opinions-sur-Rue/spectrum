package spectrum

import (
	"crypto/rand"
	"fmt"
	"strings"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

// Browser-produced captions are unverified member submissions, not trusted ASR
// worker output. The server owns attribution, epoch, IDs, bounds and ordering.
type browserTranscriptSession struct {
	id          string
	owner       *Client
	generation  uint64
	started     time.Time
	seen        time.Time
	lastPublish time.Time
	sequence    uint64
}

func init() {
	v2Handlers["transcript.start"] = handleBrowserTranscriptStart
	v2Handlers["transcript.publish"] = handleBrowserTranscriptPublish
	v2Handlers["transcript.keepalive"] = handleBrowserTranscriptTouch
	v2Handlers["transcript.stop"] = handleBrowserTranscriptStop
}

func browserTranscriptContext(c *Client, room *Room, generation uint64) error {
	role, member := room.RoleOf(c.userID)
	if !browserTranscriptionEnabled() || !c.hub.transcriptionConfigured() || !room.settings.TranscriptionEnabled || room.IsClosed() {
		return ErrTranscriptDisabled
	}
	if !member || !role.CanPublishVoice() || room.voiceRoomID == "" || generation != room.voiceGeneration {
		return ErrTranscriptSpeaker
	}
	return nil
}

func handleBrowserTranscriptStart(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		RequestID  string `json:"requestId"`
		Generation uint64 `json:"generation"`
		Consent    bool   `json:"consent"`
	}
	if err := envelope.DecodePayload(&payload); err != nil || len(payload.RequestID) > 64 || payload.RequestID == "" || !payload.Consent {
		c.v2Error(envelope, "browser_transcript_rejected", ErrTranscriptContent)
		return ErrTranscriptContent
	}
	envelope.ID = payload.RequestID
	_, roomID, _, _, _, err := c.v2RoomContext()
	var sessionID string
	if err == nil {
		err = c.hub.WithRoom(roomID, func(room *Room) error {
			if err := browserTranscriptContext(c, room, payload.Generation); err != nil {
				return err
			}
			id := room.memberIDs[c.userID]
			if room.browserTranscripts == nil {
				room.browserTranscripts = make(map[string]*browserTranscriptSession)
			}
			if time.Since(c.browserTranscriptLastStart) < time.Second {
				return ErrChatRateLimit
			}
			now := time.Now()
			c.browserTranscriptLastStart = now
			sessionID = "b_" + rand.Text()
			room.browserTranscripts[id] = &browserTranscriptSession{id: sessionID, owner: c, generation: payload.Generation, started: now, seen: now}
			return nil
		})
	}
	if err != nil {
		c.v2Error(envelope, "browser_transcript_rejected", err)
		return err
	}
	c.SendV2("transcript.started", struct {
		RoomID     string `json:"roomId"`
		RequestID  string `json:"requestId"`
		SessionID  string `json:"sessionId"`
		Generation uint64 `json:"generation"`
	}{roomID, payload.RequestID, sessionID, payload.Generation})
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}

type browserTranscriptPayload struct {
	SessionID  string `json:"sessionId"`
	Generation uint64 `json:"generation"`
	Sequence   uint64 `json:"sequence"`
	Text       string `json:"text"`
	Start      int64  `json:"start"`
	End        int64  `json:"end"`
	Language   string `json:"language"`
}

func browserTranscriptLease(c *Client, room *Room, payload browserTranscriptPayload) (*browserTranscriptSession, error) {
	if err := browserTranscriptContext(c, room, payload.Generation); err != nil {
		return nil, err
	}
	session := room.browserTranscripts[room.memberIDs[c.userID]]
	if session == nil || session.id != payload.SessionID || session.owner != c || session.generation != payload.Generation || time.Since(session.seen) > 15*time.Second {
		return nil, ErrTranscriptSpeaker
	}
	return session, nil
}

func handleBrowserTranscriptPublish(c *Client, envelope *valueobjects.Envelope) error {
	var payload browserTranscriptPayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "browser_transcript_rejected", ErrTranscriptContent)
		return err
	}
	if len(payload.SessionID) <= 64 {
		envelope.ID = payload.SessionID
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	var segment transcriptSegment
	if err == nil {
		err = c.hub.WithRoom(roomID, func(room *Room) error {
			session, err := browserTranscriptLease(c, room, payload)
			if err != nil {
				return err
			}
			now := time.Now()
			if payload.Sequence != session.sequence+1 || payload.Start < 0 || payload.End < payload.Start || payload.End-payload.Start > 15000 || payload.End > now.Sub(session.started).Milliseconds()+2000 || now.Sub(session.lastPublish) < 500*time.Millisecond {
				return ErrTranscriptContent
			}
			if pinned := room.Settings().Sanitize().TranscriptionLanguage; pinned != transcriptionLanguageAuto && pinned != payload.Language {
				return ErrTranscriptContent
			}
			if payload.Language != "fr" && payload.Language != "en" {
				return ErrTranscriptContent
			}
			segment, _, err = room.appendTranscript(transcriptSegment{
				RoomID: room.id, ID: fmt.Sprintf("%s_%d", session.id, payload.Sequence),
				SpeakerID: room.memberIDs[c.userID], SpeakerName: room.memberName(c.hub.users[c.userID]),
				Text: strings.TrimSpace(payload.Text), Start: session.started.UnixMilli() + payload.Start,
				End: session.started.UnixMilli() + payload.End, Language: payload.Language, Final: true, Source: transcriptionModeBrowser,
			})
			if err == nil {
				session.sequence = payload.Sequence
				session.seen = now
				session.lastPublish = now
			}
			return err
		})
	}
	if err != nil {
		c.v2Error(envelope, "browser_transcript_rejected", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "transcript.segment", segment, nil)
	return nil
}

func handleBrowserTranscriptTouch(c *Client, envelope *valueobjects.Envelope) error {
	var payload browserTranscriptPayload
	if err := envelope.DecodePayload(&payload); err != nil {
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		return err
	}
	envelope.ID = payload.SessionID
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		session, err := browserTranscriptLease(c, room, payload)
		if err == nil {
			session.seen = time.Now()
		}
		return err
	})
	if err != nil {
		c.v2Error(envelope, "browser_transcript_rejected", err)
	}
	return err
}

func handleBrowserTranscriptStop(c *Client, envelope *valueobjects.Envelope) error {
	var payload browserTranscriptPayload
	if err := envelope.DecodePayload(&payload); err != nil {
		return err
	}
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err != nil {
		return err
	}
	_ = c.hub.WithRoom(roomID, func(room *Room) error {
		id := room.memberIDs[c.userID]
		if session := room.browserTranscripts[id]; session != nil && session.owner == c && session.id == payload.SessionID {
			delete(room.browserTranscripts, id)
		}
		return nil
	})
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}
