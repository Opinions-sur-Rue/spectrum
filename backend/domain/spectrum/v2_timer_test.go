package spectrum

import (
	"encoding/json"
	"testing"
	"time"
)

const timerOperation = "room.timer"
const durationField = "durationSeconds"

func TestRoomTimerAdminOnlyAndBounded(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	start := socialEnvelope(t, timerOperation, map[string]int{durationField: 60})
	if err := handleRoomTimer(guest, start); err != ErrForbidden {
		t.Fatalf("spectator changed timer: %v", err)
	}
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomTimer(guest, start); err != ErrForbidden {
		t.Fatalf("participant changed timer: %v", err)
	}
	before := time.Now().UnixMilli()
	if err := handleRoomTimer(admin, start); err != nil {
		t.Fatal(err)
	}
	deadline := room.timer.EndsAt
	if room.timer.DurationSeconds != 60 || deadline < before+60000 || deadline > time.Now().UnixMilli()+60000 {
		t.Fatalf("incorrect server deadline: %+v", room.timer)
	}
	version := room.timer.Revision
	for _, payload := range []any{
		map[string]int{durationField: -1}, map[string]int{durationField: maxTimerSeconds + 1},
		map[string]float64{durationField: 1.5}, map[string]string{durationField: "60"},
		map[string]any{durationField: nil}, map[string]any{},
	} {
		if err := handleRoomTimer(admin, socialEnvelope(t, timerOperation, payload)); err == nil {
			t.Fatalf("invalid duration accepted: %v", payload)
		}
		if room.timer.EndsAt != deadline || room.timer.Revision != version {
			t.Fatal("invalid payload mutated countdown")
		}
	}
	if err := handleRoomTimer(guest, socialEnvelope(t, timerOperation, map[string]int{durationField: 0})); err != ErrForbidden {
		t.Fatal("participant cancelled timer")
	}
	if err := handleRoomTimer(admin, socialEnvelope(t, timerOperation, map[string]int{durationField: 0})); err != nil {
		t.Fatal(err)
	}
	if room.timer.EndsAt != 0 || room.timer.Revision != version+1 {
		t.Fatal("cancel did not clear deadline and advance revision")
	}
	if err := handleRoomTimer(admin, socialEnvelope(t, timerOperation, map[string]int{durationField: maxTimerSeconds})); err != nil {
		t.Fatal(err)
	}
}

func TestRoomTimerSnapshotRestoresDeadlineForAllRoles(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	if err := handleRoomTimer(admin, socialEnvelope(t, timerOperation, map[string]int{durationField: 1})); err != nil {
		t.Fatal(err)
	}
	// A finished timer remains a deadline, not a ticking task. A late join sees
	// zero remaining time instead of accidentally starting a new countdown.
	room.timer.EndsAt = time.Now().Add(-time.Second).UnixMilli()
	for _, client := range []*Client{admin, guest} {
		for len(client.send) > 0 {
			<-client.send
		}
		if err := handleRoomGet(client, socialEnvelope(t, "room.get", struct{}{})); err != nil {
			t.Fatal(err)
		}
		found := false
		for len(client.send) > 0 {
			var event struct {
				Op      string           `json:"op"`
				Payload roomStatePayload `json:"payload"`
			}
			if err := json.Unmarshal(<-client.send, &event); err != nil {
				t.Fatal(err)
			}
			if event.Op == "room.state" {
				found = true
				if event.Payload.Timer.EndsAt != room.timer.EndsAt || event.Payload.Timer.ServerNow <= room.timer.EndsAt {
					t.Fatalf("snapshot lost expired deadline or server time: %+v", event.Payload.Timer)
				}
			}
		}
		if !found {
			t.Fatal("room snapshot missing")
		}
	}
}
