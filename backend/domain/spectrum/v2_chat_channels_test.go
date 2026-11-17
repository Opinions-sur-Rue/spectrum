package spectrum

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func chatSendEnvelope(t *testing.T, channel ChatChannel, text, clientID string) *valueobjects.Envelope {
	t.Helper()
	envelope, err := valueobjects.NewEnvelope("chat.send", map[string]string{
		"text": text, "clientId": clientID, "channel": string(channel),
	})
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func chatSnapshotFor(t *testing.T, client *Client) chatSnapshot {
	t.Helper()
	if err := handleChatGet(client, spectrumEnvelope(t, "chat.get", struct{}{})); err != nil {
		t.Fatal(err)
	}
	for range 10 {
		var envelope valueobjects.Envelope
		if err := json.Unmarshal(<-client.send, &envelope); err != nil {
			t.Fatal(err)
		}
		if envelope.Op != "chat.snapshot" {
			continue
		}
		var snapshot chatSnapshot
		if err := envelope.DecodePayload(&snapshot); err != nil {
			t.Fatal(err)
		}
		return snapshot
	}
	t.Fatal("no chat snapshot delivered")
	return chatSnapshot{}
}

func TestChatChannelsGateWritingAndReading(t *testing.T) {
	hub, admin, spectator, room := stageFixture(t)
	start := time.Now()
	for index, entry := range []struct {
		channel  ChatChannel
		text     string
		clientID string
	}{{ChatRoom, "Room", "r1"}, {ChatStage, "Stage", "s1"}, {ChatAdmin, "Admin", "a1"}} {
		if _, _, err := room.appendChat(hub.users[admin.userID], entry.channel, entry.text, entry.clientID, start.Add(time.Duration(index)*time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	now := start.Add(10 * time.Second)
	if err := handleChatSend(spectator, chatSendEnvelope(t, ChatStage, "no", "s2")); err != ErrForbidden {
		t.Fatalf("spectator stage write = %v", err)
	}
	if err := handleChatSend(spectator, chatSendEnvelope(t, ChatAdmin, "no", "a2")); err != ErrForbidden {
		t.Fatalf("spectator admin write = %v", err)
	}
	if _, _, err := room.appendChat(hub.users[spectator.userID], ChatRoom, "needs setting", "r2", now); err != ErrForbidden {
		t.Fatalf("spectator room write without setting = %v", err)
	}
	settings := spectrumEnvelope(t, "room.settings", map[string]bool{"spectatorChatEnabled": true})
	if err := handleRoomSettings(admin, settings); err != nil {
		t.Fatal(err)
	}
	if _, _, err := room.appendChat(hub.users[spectator.userID], ChatRoom, "Room reply", "r3", now); err != nil {
		t.Fatal(err)
	}
	if _, _, err := room.appendChat(hub.users[spectator.userID], ChatAdmin, "still no", "a3", now); err != ErrForbidden {
		t.Fatal("spectator admin write allowed by the room chat setting")
	}
	if _, _, err := room.appendChat(hub.users[admin.userID], "unknown", "x", "u1", now); err != ErrChatChannel {
		t.Fatalf("unknown channel = %v", err)
	}
	// A spectator snapshot carries only the room channel, so it cannot even
	// count how many stage or admin messages exist.
	visible := chatSnapshotFor(t, spectator)
	if len(visible.Messages) != 2 {
		t.Fatalf("spectator messages = %+v", visible.Messages)
	}
	for _, message := range visible.Messages {
		if message.Channel != ChatRoom {
			t.Fatalf("spectator received %s channel message", message.Channel)
		}
	}
	everything := chatSnapshotFor(t, admin)
	if len(everything.Messages) != 4 {
		t.Fatalf("admin messages = %+v", everything.Messages)
	}
}

func TestChatChannelHistoriesAreSeparateAndCooldownIsShared(t *testing.T) {
	hub, admin, _, room := stageFixture(t)
	user := hub.users[admin.userID]
	now := time.Now()
	if _, _, err := room.appendChat(user, ChatStage, "Stage only", "s1", now); err != nil {
		t.Fatal(err)
	}
	if _, _, err := room.appendChat(user, ChatAdmin, "immediately after", "a1", now.Add(time.Millisecond)); err != ErrChatRateLimit {
		t.Fatalf("cross-channel cooldown bypass = %v", err)
	}
	// A busy channel cannot evict another one's history.
	for index := range ChatHistoryLimit + 5 {
		if _, _, err := room.appendChat(user, ChatRoom, fmt.Sprintf("room %d", index), fmt.Sprintf("r%d", index), now.Add(time.Duration(index+1)*time.Second)); err != nil {
			t.Fatal(err)
		}
	}
	if len(room.chatMessages[ChatRoom]) != ChatHistoryLimit || len(room.chatMessages[ChatStage]) != 1 {
		t.Fatalf("histories = %d/%d", len(room.chatMessages[ChatRoom]), len(room.chatMessages[ChatStage]))
	}
	if room.chatMessages[ChatStage][0].Channel != ChatStage {
		t.Fatal("stored message lost its channel")
	}
}

func TestChatRemovalMasksTextAndKeepsConversationAnchored(t *testing.T) {
	hub, admin, spectator, room := stageFixture(t)
	settings := spectrumEnvelope(t, "room.settings", map[string]bool{"spectatorChatEnabled": true})
	if err := handleRoomSettings(admin, settings); err != nil {
		t.Fatal(err)
	}
	speaker, _, err := room.appendChat(hub.users[admin.userID], ChatStage, "Personal attack", "s1", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := handleChatRemove(spectator, spectrumEnvelope(t, "chat.remove", map[string]any{"messageId": speaker.ID})); err != ErrForbidden {
		t.Fatalf("spectator removal = %v", err)
	}
	if err := handleChatRemove(admin, spectrumEnvelope(t, "chat.remove", map[string]any{"messageId": speaker.ID})); err != nil {
		t.Fatal(err)
	}
	stored := room.chatMessages[ChatStage][0]
	if !stored.Removed || stored.Text != "" || stored.ClientID != "" || stored.ID != speaker.ID {
		t.Fatalf("stored message after removal = %+v", stored)
	}
	if err := handleChatRemove(admin, spectrumEnvelope(t, "chat.remove", map[string]any{"messageId": 9999})); err != ErrChatContent {
		t.Fatalf("unknown message removal = %v", err)
	}
	// The removal is only announced inside the channel audience.
	allowed := chatAudience(ChatStage)
	if allowed(spectator.userID, RoleSpectator) {
		t.Fatal("spectator may receive stage messages")
	}
	if !allowed(admin.userID, RoleAdmin) {
		t.Fatal("admin may not receive stage messages")
	}
}

func TestChatRemoveKeepsAdminChannelPrivateFromStageMembers(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	private, _, err := room.appendChat(hub.users[admin.userID], ChatAdmin, "Moderation note", "a1", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(chatSnapshotFor(t, guest).Messages) != 0 {
		t.Fatal("participant saw the admin channel")
	}
	if err := handleChatRemove(guest, spectrumEnvelope(t, "chat.remove", map[string]any{"messageId": private.ID})); err != ErrForbidden {
		t.Fatalf("participant removed an admin-channel message: %v", err)
	}
	if room.chatMessages[ChatAdmin][0].Removed {
		t.Fatal("rejected removal mutated the message")
	}
}
