package spectrum

import (
	"encoding/json"
	"testing"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func speakingEnvelope(t *testing.T, speaking bool) *valueobjects.Envelope {
	t.Helper()
	envelope, err := valueobjects.NewEnvelope("voice.speaking", map[string]bool{"speaking": speaking})
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func roomState(t *testing.T, client *Client) (roomStatePayload, map[string]roomMemberPayload) {
	t.Helper()
	if err := handleRoomGet(client, stageEnvelope(t, "room.get", "")); err != nil {
		t.Fatal(err)
	}
	raw := <-client.send
	var event struct {
		Payload roomStatePayload `json:"payload"`
	}
	if err := json.Unmarshal(raw, &event); err != nil {
		t.Fatal(err)
	}
	members := make(map[string]roomMemberPayload, len(event.Payload.Members))
	for _, member := range event.Payload.Members {
		members[member.ID] = member
	}
	return event.Payload, members
}

func TestSpeakingTimeAccruesForItsOwnPublisherOnly(t *testing.T) {
	hub, admin, actor, room, _ := voiceFixture(t)
	id := room.memberIDs[actor.userID]
	if err := handleVoiceSpeaking(actor, speakingEnvelope(t, true)); err != nil {
		t.Fatal(err)
	}
	if err := hub.WithRoom(room.id, func(r *Room) error {
		if !r.startSpeaking(id, time.Now().UnixMilli()) {
			return nil
		}
		t.Fatal("duplicate start reopened a running turn")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// Rewind the open interval to simulate a real turn without sleeping.
	if err := hub.WithRoom(room.id, func(r *Room) error {
		r.speakingStartedAt[id] = time.Now().Add(-12 * time.Second).UnixMilli()
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// A forged stop with another selector cannot close somebody else's turn.
	forged, _ := valueobjects.NewEnvelope("voice.speaking", map[string]any{"speaking": true, "memberId": room.memberIDs[admin.userID]})
	if err := handleVoiceSpeaking(actor, forged); err != nil {
		t.Fatal(err)
	}
	if err := handleVoiceSpeaking(actor, speakingEnvelope(t, false)); err != nil {
		t.Fatal(err)
	}
	if seconds := room.speakingSecondsFor(id); seconds < 12 || seconds > 14 {
		t.Fatalf("speaking time = %ds", seconds)
	}
	_, members := roomState(t, actor)
	if members[id].SpeakingSeconds < 12 {
		t.Fatal("room state did not expose speaking time")
	}
	if members[room.memberIDs[admin.userID]].SpeakingSeconds != 0 {
		t.Fatal("forged payload credited another member")
	}
	// A repeated stop is a no-op rather than a new interval.
	if err := handleVoiceSpeaking(actor, speakingEnvelope(t, false)); err != nil {
		t.Fatal(err)
	}
	if seconds := room.speakingSecondsFor(id); seconds < 12 || seconds > 14 {
		t.Fatalf("repeated stop changed time to %ds", seconds)
	}
}

func TestSpeakingTimeIgnoresSpectatorsAndModeratedMembers(t *testing.T) {
	_, admin, actor, room, _ := voiceFixture(t)
	id := room.memberIDs[actor.userID]
	if err := handleVoiceMute(admin, stageEnvelope(t, "voice.mute", id)); err != nil {
		t.Fatal(err)
	}
	if err := handleVoiceSpeaking(actor, speakingEnvelope(t, true)); err != nil {
		t.Fatal(err)
	}
	if _, open := room.speakingStartedAt[id]; open || room.speakingSecondsFor(id) != 0 {
		t.Fatal("moderated member accrued speaking time")
	}
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", id)); err != nil {
		t.Fatal(err)
	}
	if err := handleVoiceSpeaking(actor, speakingEnvelope(t, true)); err != nil {
		t.Fatal(err)
	}
	if _, open := room.speakingStartedAt[id]; open {
		t.Fatal("spectator accrued speaking time")
	}
}

func TestSpeakingTurnStopsOnModerationDisconnectAndBoundedInterval(t *testing.T) {
	if limit := boundedSpeakingInterval(0, int64(maxSpeakingInterval/time.Millisecond)*3); limit != int64(maxSpeakingInterval/time.Millisecond) {
		t.Fatal("runaway interval was not capped")
	}
	if boundedSpeakingInterval(100, 100) != 0 || boundedSpeakingInterval(100, 90) != 0 {
		t.Fatal("clock skew credited time")
	}
	hub, admin, actor, room, _ := voiceFixture(t)
	id := room.memberIDs[actor.userID]
	if err := handleVoiceSpeaking(actor, speakingEnvelope(t, true)); err != nil {
		t.Fatal(err)
	}
	if err := handleVoiceMute(admin, stageEnvelope(t, "voice.mute", id)); err != nil {
		t.Fatal(err)
	}
	if _, open := room.speakingStartedAt[id]; open {
		t.Fatal("moderation left a speaking turn open")
	}
	if err := handleVoiceResume(actor, resumeEnvelope(t, false)); err != nil {
		t.Fatal(err)
	}
	if err := handleVoiceSpeaking(actor, speakingEnvelope(t, true)); err != nil {
		t.Fatal(err)
	}
	client := &Client{hub: hub, userID: actor.userID, send: make(chan []byte, 4)}
	hub.clients[client] = true
	hub.unregisterClient(client)
	if _, open := room.speakingStartedAt[id]; open {
		t.Fatal("disconnect left a speaking turn open through its grace period")
	}
}
