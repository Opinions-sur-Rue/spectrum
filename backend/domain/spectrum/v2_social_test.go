package spectrum

import (
	"bytes"
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func socialEnvelope(t *testing.T, op string, payload any) *valueobjects.Envelope {
	t.Helper()
	envelope, err := valueobjects.NewEnvelope(op, payload)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestRaisedHandsAreAuthoritativeAndAdminCanOnlyLowerOthers(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	raise := socialEnvelope(t, "room.hand", map[string]any{fieldRaised: true})
	if err := handleRoomHand(guest, raise); err != nil {
		t.Fatal(err)
	}
	first := room.raisedHands[guest.userID]
	if first == 0 {
		t.Fatal("spectator hand missing")
	}
	if err := handleRoomHand(guest, raise); err != nil || first != room.raisedHands[guest.userID] {
		t.Fatal("idempotent raise lost queue order")
	}
	for _, payload := range []map[string]any{
		{fieldMemberID: room.memberIDs[admin.userID], fieldRaised: false},
		{fieldMemberID: guest.userID, fieldRaised: true},
		{fieldMemberID: fixtureOutsideMemberID, fieldRaised: false},
		{},
	} {
		if err := handleRoomHand(guest, socialEnvelope(t, "room.hand", payload)); err == nil {
			t.Fatal("untrusted hand update accepted")
		}
	}
	if err := handleRoomHand(admin, socialEnvelope(t, "room.hand", map[string]any{fieldMemberID: room.memberIDs[guest.userID], fieldRaised: true})); err == nil {
		t.Fatal("admin raised someone else's hand")
	}
	if err := handleRoomHand(admin, socialEnvelope(t, "room.hand", map[string]any{fieldMemberID: room.memberIDs[guest.userID], fieldRaised: false})); err != nil {
		t.Fatal(err)
	}
	if len(room.raisedHands) != 0 {
		t.Fatal("lower did not clear hand")
	}
	if err := handleRoomHand(guest, raise); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomLeave(guest, raise); err != nil {
		t.Fatal(err)
	}
	if len(room.raisedHands) != 0 {
		t.Fatal("departure retained hand")
	}
}

func TestReactionsBoundedValidatedScopedAndPrivateIDsNeverBroadcast(t *testing.T) {
	hub, admin, guest, room := stageFixture(t)
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	for len(hub.messages) > 0 {
		<-hub.messages
	}
	if err := handleRoomReact(guest, socialEnvelope(t, "room.react", map[string]string{fieldEmoji: "<script>"})); err == nil {
		t.Fatal("arbitrary reaction accepted")
	}
	react := socialEnvelope(t, "room.react", map[string]string{fieldEmoji: "👍"})
	if err := handleRoomReact(guest, react); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomReact(guest, react); err == nil {
		t.Fatal("reaction cooldown not enforced")
	}
	count := 0
	for len(hub.messages) > 0 {
		message := <-hub.messages
		if bytes.Contains(message.Content(), []byte("private-")) {
			t.Fatal("signin ID leaked")
		}
		if !bytes.Contains(message.Content(), []byte(room.memberIDs[guest.userID])) {
			t.Fatal("public member ID missing")
		}
		count++
	}
	if count != 2 {
		t.Fatal("reaction audience", count)
	}
	if err := hub.LeaveRoom(room.id, "", guest.userID); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomReact(guest, react); err == nil {
		t.Fatal("nonmember reacted")
	}
}

func TestOnlyStageMembersCanReactButSpectatorsCanRaiseHands(t *testing.T) {
	_, admin, guest, room := stageFixture(t)
	react := socialEnvelope(t, "room.react", map[string]string{fieldEmoji: "👍"})
	if err := handleRoomReact(guest, react); err != ErrForbidden {
		t.Fatalf("spectator reaction = %v", err)
	}
	if err := handleRoomHand(guest, socialEnvelope(t, "room.hand", map[string]bool{fieldRaised: true})); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomReact(admin, react); err != nil {
		t.Fatal("admin cannot react", err)
	}
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomReact(guest, react); err != nil {
		t.Fatal("participant cannot react", err)
	}
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[guest.userID])); err != nil {
		t.Fatal(err)
	}
	room.reactionLastSent[guest.userID] = 0
	if err := handleRoomReact(guest, react); err != ErrForbidden {
		t.Fatalf("demoted member reaction = %v", err)
	}
}
