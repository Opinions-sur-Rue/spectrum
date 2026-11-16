package spectrum

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"time"

	voicedomain "Opinions-sur-Rue/spectrum/domain/voice"
)

type fakeVoice struct {
	mu            sync.Mutex
	deleted       []string
	removed       []string
	removeErr     error
	permissionErr error
	permissions   map[string]bool
	deleteErr     error
	deleting      chan struct{}
	allowDelete   chan struct{}
}

func (f *fakeVoice) RemoveParticipant(_ context.Context, room, identity string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.removeErr != nil {
		return f.removeErr
	}
	f.removed = append(f.removed, room+":"+identity)
	return nil
}

func (f *fakeVoice) Prepare(context.Context) error            { return nil }
func (f *fakeVoice) CreateRoom(context.Context, string) error { return nil }
func (f *fakeVoice) PublicURL() string                        { return "ws://127.0.0.1:7880" }
func (f *fakeVoice) JoinToken(string, string, bool, ...string) (string, error) {
	return "fixture-token", nil
}
func (f *fakeVoice) VerifyAdmission(string) (voicedomain.Admission, error) {
	return voicedomain.Admission{}, errors.New("invalid token")
}
func (f *fakeVoice) ProxySignal(http.ResponseWriter, *http.Request, func()) {}
func (f *fakeVoice) SetPublishPermission(ctx context.Context, room, identity string, publish bool) error {
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
	if f.permissionErr != nil {
		return f.permissionErr
	}
	if f.permissions == nil {
		f.permissions = make(map[string]bool)
	}
	f.permissions[room+":"+identity] = publish
	return nil
}
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

func TestVoiceDemotionChangesOnlyTargetPermissions(t *testing.T) {
	_, admin, actor, room, driver := voiceFixture(t)
	oldRoom := room.voiceRoomID
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if len(driver.deleted) != 0 || room.voiceRoomID != oldRoom || room.voiceGeneration != 0 || driver.permissions[oldRoom+":"+room.memberIDs[actor.userID]] {
		t.Fatal("demotion disrupted the room or retained publication")
	}
	credentials, err := actor.issueVoiceCredentials()
	if err != nil {
		t.Fatal(err)
	}
	if credentials.CanPublish || credentials.Generation != 0 || room.voiceRoomID != oldRoom {
		t.Fatal("demoted participant retained old admission")
	}
}

func TestVoiceRevocationFailureDoesNotChangeRole(t *testing.T) {
	_, admin, actor, room, driver := voiceFixture(t)
	driver.permissionErr = errors.New("SFU unavailable")
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

func TestVoiceMembershipRemovalPaths(t *testing.T) {
	for _, action := range []string{voiceReasonLeave, voiceReasonKick, fixtureStopAction, voiceReasonExpire} {
		t.Run(action, func(t *testing.T) {
			hub, admin, actor, room, driver := voiceFixture(t)
			oldRoom := room.voiceRoomID
			oldGeneration := room.voiceGeneration
			var err error
			switch action {
			case voiceReasonLeave:
				err = hub.LeaveRoom(room.id, hub.users[actor.userID].Color, actor.userID)
			case voiceReasonKick:
				err = hub.KickByColor(room.id, admin.userID, hub.users[actor.userID].Color)
			case fixtureStopAction:
				err = hub.StopRoom(room.id)
			case voiceReasonExpire:
				hub.users[actor.userID].beginningGracePeriod = time.Now().Unix() - 120
				hub.cleanupRoom(room.id)
			}
			if err != nil {
				t.Fatal(err)
			}
			if action == voiceReasonLeave || action == voiceReasonExpire || action == voiceReasonKick {
				if len(driver.deleted) != 0 || len(driver.removed) != 1 || driver.removed[0] != oldRoom+":"+room.memberIDs[actor.userID] || room.voiceRoomID != oldRoom || room.voiceGeneration != oldGeneration {
					t.Fatal("departure disrupted other SFU participants")
				}
			} else if len(driver.deleted) != 1 || driver.deleted[0] != oldRoom {
				t.Fatal("revocation left old SFU room active")
			}
			if action != fixtureStopAction {
				if _, present := room.RoleOf(actor.userID); present {
					t.Fatal("member not removed")
				}
			}
		})
	}
}

func TestVoiceExpirationRemovesSpectatorWithoutRetiringRoom(t *testing.T) {
	hub, admin, actor, room, driver := voiceFixture(t)
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.issueVoiceCredentials(); err != nil {
		t.Fatal(err)
	}
	driver.deleted = nil
	physical, generation := room.voiceRoomID, room.voiceGeneration
	hub.users[actor.userID].beginningGracePeriod = time.Now().Unix() - 120
	hub.cleanupRoom(room.id)
	if len(driver.deleted) != 0 || len(driver.removed) != 1 || driver.removed[0] != physical+":"+room.memberIDs[actor.userID] || room.voiceGeneration != generation || room.voiceRoomID != physical {
		t.Fatal("spectator expiration disrupted remaining speaker")
	}
	if _, present := room.RoleOf(actor.userID); present {
		t.Fatal("expired spectator retained membership")
	}
}

func TestVoiceExpirationFailsClosedWhenParticipantRemovalFails(t *testing.T) {
	hub, _, actor, room, driver := voiceFixture(t)
	driver.removeErr = errors.New("SFU unavailable")
	hub.users[actor.userID].beginningGracePeriod = time.Now().Unix() - 120
	hub.cleanupRoom(room.id)
	if _, present := room.RoleOf(actor.userID); !present {
		t.Fatal("failed removal changed membership")
	}
	if len(driver.deleted) != 0 {
		t.Fatal("failed removal retired other speakers")
	}
	driver.removeErr = nil
	hub.cleanupRoom(room.id)
	if _, present := room.RoleOf(actor.userID); present {
		t.Fatal("retry did not expire member")
	}
}

func TestVoiceLastStageDepartureStillRetiresRoom(t *testing.T) {
	hub, admin, actor, room, driver := voiceFixture(t)
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.issueVoiceCredentials(); err != nil {
		t.Fatal(err)
	}
	driver.deleted = nil
	physical := room.voiceRoomID
	if err := hub.LeaveRoom(room.id, "", admin.userID); err != nil {
		t.Fatal(err)
	}
	if len(driver.deleted) != 1 || driver.deleted[0] != physical || hub.rooms[room.id] != nil {
		t.Fatal("final stage departure left spectator voice tokens active")
	}
}
