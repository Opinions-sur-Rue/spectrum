package spectrum

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func TestChatPermissionsAndUntrustedIdentity(t *testing.T) {
	hub, admin, spectator, room := stageFixture(t)
	request := spectrumEnvelope(t, "chat.send", map[string]string{"text": "Hello", "clientId": "request-1", fieldMemberID: room.memberIDs[admin.userID], "nickname": "Forged admin"})
	if err := handleChatSend(spectator, request); err != ErrForbidden {
		t.Fatalf("spectator error = %v", err)
	}
	if err := spectator.EvaluateRPC(&valueobjects.MessageContent{Procedure: "sendchatmessage", Arguments: []string{"bypass"}}); err != ErrForbidden {
		t.Fatalf("legacy bypass error = %v", err)
	}
	settings := spectrumEnvelope(t, "room.settings", map[string]bool{"spectatorChatEnabled": true})
	if err := handleRoomSettings(spectator, settings); err != ErrForbidden {
		t.Fatal("spectator changed chat settings")
	}
	if err := handleRoomSettings(admin, settings); err != nil {
		t.Fatal(err)
	}
	if err := handleChatSend(spectator, request); err != nil {
		t.Fatal(err)
	}
	message := room.chatMessages[0]
	if message.MemberID != room.memberIDs[spectator.userID] || message.Nickname == "Forged admin" || message.ClientID != "request-1" {
		t.Fatalf("identity was not authoritative: %+v", message)
	}
	for len(hub.messages) > 0 {
		frame := (<-hub.messages).Content()
		if bytes.Contains(frame, []byte(admin.userID)) || bytes.Contains(frame, []byte(spectator.userID)) {
			t.Fatal("chat exposed signin identity")
		}
	}
}

func TestChatRetryCooldownAndValidation(t *testing.T) {
	hub, admin, _, room := stageFixture(t)
	user := hub.users[admin.userID]
	now := time.Now()
	first, _, err := room.appendChat(user, "  Hello  ", "same-request", now)
	if err != nil {
		t.Fatal(err)
	}
	duplicate, retried, err := room.appendChat(user, "different body", "same-request", now.Add(time.Millisecond))
	if err != nil || !retried || duplicate.ID != first.ID || duplicate.Text != "Hello" || room.chatSequence != 1 {
		t.Fatal("retry duplicated or changed message")
	}
	if _, _, err := room.appendChat(user, "too soon", "new-request", now.Add(time.Millisecond)); err != ErrChatRateLimit {
		t.Fatalf("cooldown error = %v", err)
	}
	for _, text := range []string{"  ", strings.Repeat("é", ChatMessageLimit+1)} {
		if _, _, err := room.appendChat(user, text, "invalid", now.Add(time.Second)); err != ErrChatContent {
			t.Fatalf("validation error = %v", err)
		}
	}
	if len(room.chatMessages) != 1 || room.chatSequence != 1 {
		t.Fatal("rejected message mutated history")
	}
	if _, _, err := room.appendChat(user, "Later", "later", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
}

func TestChatHistoryIsBoundedAndSnapshotsAreCopies(t *testing.T) {
	hub, admin, spectator, room := stageFixture(t)
	now := time.Now()
	for index := range ChatHistoryLimit + 20 {
		if _, _, err := room.appendChat(hub.users[admin.userID], fmt.Sprintf("message %d", index), fmt.Sprintf("id-%d", index), now.Add(time.Duration(index)*time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	if len(room.chatMessages) != ChatHistoryLimit || room.chatMessages[0].ID != 21 {
		t.Fatal("history exceeded bound or retained wrong messages")
	}
	if err := handleChatGet(spectator, spectrumEnvelope(t, "chat.get", struct{}{})); err != nil {
		t.Fatal(err)
	}
	var envelope valueobjects.Envelope
	if err := json.Unmarshal(<-spectator.send, &envelope); err != nil {
		t.Fatal(err)
	}
	var snapshot chatSnapshot
	if err := envelope.DecodePayload(&snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Sequence != 120 || len(snapshot.Messages) != ChatHistoryLimit {
		t.Fatal("incomplete history")
	}
	snapshot.Messages[0].Text = "changed"
	if room.chatMessages[0].Text == "changed" {
		t.Fatal("snapshot aliases stored history")
	}
}

func TestChatRespectsDemotionAndRoomIsolation(t *testing.T) {
	hub, admin, actor, room := stageFixture(t)
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if _, _, err := room.appendChat(hub.users[actor.userID], "Participant", "one", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if _, _, err := room.appendChat(hub.users[actor.userID], "After demotion", "two", time.Now().Add(time.Second)); err != ErrForbidden {
		t.Fatalf("demoted user error = %v", err)
	}
	hub.users["other-room-admin"] = NewUser("other-room-admin")
	otherID, _, err := hub.NewRoom("other-room-admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := hub.rooms[otherID].appendChat(hub.users["other-room-admin"], "PRIVATE OTHER ROOM", "other", time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := handleChatGet(actor, spectrumEnvelope(t, "chat.get", map[string]string{"roomId": otherID})); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(<-actor.send, []byte("PRIVATE OTHER ROOM")) {
		t.Fatal("history leaked across rooms")
	}
}
