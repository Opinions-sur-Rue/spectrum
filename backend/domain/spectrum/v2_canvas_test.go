package spectrum

import (
	"testing"

	canvasdomain "Opinions-sur-Rue/spectrum/domain/canvas"
)

func noteFixture(author string, moderation canvasdomain.Moderation, visible bool) canvasdomain.Note {
	return canvasdomain.Note{
		ID:         "note-1",
		AuthorID:   author,
		Moderation: moderation,
		Visible:    visible,
	}
}

func TestCanSeeNote(t *testing.T) {
	pending := noteFixture(fixtureAuthorID, canvasdomain.ModerationPending, false)
	approvedHidden := noteFixture(fixtureAuthorID, canvasdomain.ModerationApproved, false)
	approvedVisible := noteFixture(fixtureAuthorID, canvasdomain.ModerationApproved, true)

	spectatorsAllowed := DefaultRoomSettings()
	spectatorsAllowed.NotesVisibleToSpectators = true

	spectatorsDenied := DefaultRoomSettings()
	spectatorsDenied.NotesVisibleToSpectators = false

	tests := []struct {
		name     string
		userID   string
		role     Role
		settings RoomSettings
		note     canvasdomain.Note
		want     bool
	}{
		{"admin sees pending", fixtureAdminID, RoleAdmin, spectatorsDenied, pending, true},
		{"author sees own pending", fixtureAuthorID, RoleParticipant, spectatorsDenied, pending, true},
		{"other participant does not see pending", fixtureOtherID, RoleParticipant, spectatorsDenied, pending, false},
		{"spectator does not see pending", fixtureSpectatorID, RoleSpectator, spectatorsAllowed, pending, false},
		{"participant does not see approved but hidden", fixtureOtherID, RoleParticipant, spectatorsDenied, approvedHidden, false},
		{"participant sees approved and visible", fixtureOtherID, RoleParticipant, spectatorsDenied, approvedVisible, true},
		{"spectator sees visible note when allowed", fixtureSpectatorID, RoleSpectator, spectatorsAllowed, approvedVisible, true},
		{"spectator cannot see when disabled", fixtureSpectatorID, RoleSpectator, spectatorsDenied, approvedVisible, false},
		{"demoted author does not see their own pending note", fixtureAuthorID, RoleSpectator, spectatorsAllowed, pending, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canSeeNote(tt.userID, tt.role, tt.settings, tt.note); got != tt.want {
				t.Fatalf("canSeeNote() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCanEditNote(t *testing.T) {
	pending := noteFixture(fixtureAuthorID, canvasdomain.ModerationPending, false)
	rejected := noteFixture(fixtureAuthorID, canvasdomain.ModerationRejected, false)
	approved := noteFixture(fixtureAuthorID, canvasdomain.ModerationApproved, true)

	tests := []struct {
		name   string
		userID string
		role   Role
		note   canvasdomain.Note
		want   bool
	}{
		{"admin edits anything", fixtureAdminID, RoleAdmin, approved, true},
		{"author edits pending", fixtureAuthorID, RoleParticipant, pending, true},
		{"author edits rejected", fixtureAuthorID, RoleParticipant, rejected, true},
		{"author cannot edit approved", fixtureAuthorID, RoleParticipant, approved, false},
		{"other cannot edit", fixtureOtherID, RoleParticipant, pending, false},
		{"spectator cannot edit", fixtureSpectatorID, RoleSpectator, pending, false},
		{"demoted author cannot edit", fixtureAuthorID, RoleSpectator, pending, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canEditNote(tt.userID, tt.role, tt.note); got != tt.want {
				t.Fatalf("canEditNote() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEdgeAudienceRequiresBothEndpoints(t *testing.T) {
	board := canvasdomain.New()

	first, err := board.CreateNote(fixtureAuthorID, canvasdomain.NoteDraft{Title: "first"}, canvasdomain.ModerationApproved)
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}
	second, err := board.CreateNote(fixtureAuthorID, canvasdomain.NoteDraft{Title: "second"}, canvasdomain.ModerationApproved)
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	edge, err := board.CreateEdge(first.ID, second.ID, canvasdomain.RelationSupports, "")
	if err != nil {
		t.Fatalf("CreateEdge: %v", err)
	}

	settings := DefaultRoomSettings()
	allow := edgeAudience(settings, board, edge)

	if !allow(fixtureAdminID, RoleAdmin) {
		t.Fatal("admin must always see the edge")
	}
	if allow(fixtureOtherID, RoleParticipant) {
		t.Fatal("an edge between hidden notes must stay hidden")
	}

	if _, err := board.Reveal(first.ID, true); err != nil {
		t.Fatalf("Reveal: %v", err)
	}
	if allow(fixtureOtherID, RoleParticipant) {
		t.Fatal("one visible endpoint is not enough")
	}

	if _, err := board.Reveal(second.ID, true); err != nil {
		t.Fatalf("Reveal: %v", err)
	}
	if !allow(fixtureOtherID, RoleParticipant) {
		t.Fatal("a participant must see an edge between two visible notes")
	}
	if allow(fixtureSpectatorID, RoleSpectator) {
		t.Fatal("spectators are denied when notes are hidden from them")
	}
}
