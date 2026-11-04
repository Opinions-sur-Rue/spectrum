package spectrum

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type fakeVoice struct {
	mu          sync.Mutex
	deleted     []string
	deleteErr   error
	deleting    chan struct{}
	allowDelete chan struct{}
}

func (f *fakeVoice) Prepare(context.Context) error                  { return nil }
func (f *fakeVoice) CreateRoom(context.Context, string) error       { return nil }
func (f *fakeVoice) PublicURL() string                              { return "ws://127.0.0.1:7880" }
func (f *fakeVoice) JoinToken(string, string, bool) (string, error) { return "fixture-token", nil }
func (f *fakeVoice) DeleteRoom(ctx context.Context, room string) error {
	if f.deleting != nil {
		close(f.deleting)
		select {
		case <-f.allowDelete:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.deleteErr != nil {
		return f.deleteErr
	}
	f.deleted = append(f.deleted, room)
	return nil
}

func voiceFixture(t *testing.T) (*Hub, *Client, *Client, *Room, *fakeVoice) {
	t.Helper()
	hub, admin, actor, room := stageFixture(t)
	driver := &fakeVoice{}
	hub.voiceBackend = driver
	hub.voiceEnabled = true
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	credentials, err := actor.issueVoiceCredentials()
	if err != nil || !credentials.CanPublish {
		t.Fatalf("participant voice: %+v, %v", credentials, err)
	}
	return hub, admin, actor, room, driver
}

func TestVoiceDemotionRetiresCachedTokenRoom(t *testing.T) {
	_, admin, actor, room, driver := voiceFixture(t)
	oldRoom := room.voiceRoomID
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if len(driver.deleted) != 1 || driver.deleted[0] != oldRoom || room.voiceRoomID != "" || room.voiceGeneration != 1 {
		t.Fatal("old publishing room was not retired")
	}
	credentials, err := actor.issueVoiceCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if credentials.CanPublish || credentials.Generation != 1 || room.voiceRoomID == oldRoom {
		t.Fatal("demoted participant retained old admission")
	}
}

func TestVoiceRevocationFailureDoesNotChangeRole(t *testing.T) {
	_, admin, actor, room, driver := voiceFixture(t)
	driver.deleteErr = errors.New("SFU unavailable")
	oldRoom := room.voiceRoomID
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID])); err == nil {
		t.Fatal("demotion accepted without voice revocation")
	}
	if role, _ := room.RoleOf(actor.userID); role != RoleParticipant || room.voiceRoomID != oldRoom || room.voiceGeneration != 0 {
		t.Fatal("failed revocation partially changed role")
	}
}

func TestVoiceJoinCannotRacePastDemotion(t *testing.T) {
	hub, admin, actor, room, driver := voiceFixture(t)
	driver.deleting, driver.allowDelete = make(chan struct{}), make(chan struct{})
	demoted := make(chan error, 1)
	go func() {
		demoted <- handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID]))
	}()
	select {
	case <-driver.deleting:
	case <-time.After(time.Second):
		t.Fatal("SFU revocation not reached")
	}
	// The hub lock remains available while the external SFU call is pending.
	read := make(chan struct{})
	go func() { hub.WithRoomRead(room.id, func(room *Room) {}); close(read) }()
	select {
	case <-read:
	case <-time.After(time.Second):
		t.Fatal("SFU call held hub lock")
	}
	joined := make(chan voiceCredentials, 1)
	go func() { credentials, _ := actor.issueVoiceCredentials(); joined <- credentials }()
	select {
	case <-joined:
		t.Fatal("token issuance bypassed pending revocation")
	case <-time.After(30 * time.Millisecond):
	}
	close(driver.allowDelete)
	if err := <-demoted; err != nil {
		t.Fatal(err)
	}
	select {
	case credentials := <-joined:
		if credentials.CanPublish {
			t.Fatal("stale publishing token issued")
		}
	case <-time.After(time.Second):
		t.Fatal("listener token not issued")
	}
}

func TestVoiceMembershipRemovalPathsRetireRooms(t *testing.T) {
	for _, action := range []string{"leave", "kick", "stop", "expire"} {
		t.Run(action, func(t *testing.T) {
			hub, admin, actor, room, driver := voiceFixture(t)
			oldRoom := room.voiceRoomID
			var err error
			switch action {
			case "leave":
				err = hub.LeaveRoom(room.id, hub.users[actor.userID].Color, actor.userID)
			case "kick":
				err = hub.KickByColor(room.id, admin.userID, hub.users[actor.userID].Color)
			case "stop":
				err = hub.StopRoom(room.id)
			case "expire":
				hub.users[actor.userID].beginningGracePeriod = time.Now().Unix() - 120
				hub.cleanupRoom(room.id)
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(driver.deleted) != 1 || driver.deleted[0] != oldRoom {
				t.Fatal("membership removal left old SFU room active")
			}
			if action != "stop" {
				if _, present := room.RoleOf(actor.userID); present {
					t.Fatal("member not removed")
				}
			}
		})
	}
}
