package canvas

import (
	"errors"
	"strings"
	"sync"
	"testing"
)

func mustCreate(t *testing.T, c *Canvas, title string) Note {
	t.Helper()

	note, err := c.CreateNote("user-1", NoteDraft{Title: title, Markdown: "body"}, ModerationPending)
	if err != nil {
		t.Fatalf("CreateNote(%q): %v", title, err)
	}
	return note
}

func TestCreateNoteDefaults(t *testing.T) {
	c := New()

	note := mustCreate(t, c, "Hello")

	if note.ID == "" {
		t.Fatal("note must have an id")
	}
	if note.Version != 1 {
		t.Fatalf("Version = %d, want 1", note.Version)
	}
	if note.Moderation != ModerationPending {
		t.Fatalf("Moderation = %q, want pending", note.Moderation)
	}
	if note.Visible {
		t.Fatal("a new note must not be visible")
	}
	if note.Width != DefaultNoteWidth || note.Height != DefaultNoteHeight {
		t.Fatalf("size = %vx%v, want %vx%v", note.Width, note.Height, DefaultNoteWidth, DefaultNoteHeight)
	}
	if c.Revision() != 1 {
		t.Fatalf("Revision = %d, want 1", c.Revision())
	}
}

func TestCreateNoteValidation(t *testing.T) {
	c := New()

	tests := []struct {
		name       string
		draft      NoteDraft
		moderation Moderation
		want       error
	}{
		{"empty title", NoteDraft{Title: "   "}, ModerationPending, ErrInvalidTitle},
		{"title too long", NoteDraft{Title: strings.Repeat("a", MaxNoteTitleRunes+1)}, ModerationPending, ErrInvalidTitle},
		{"markdown too long", NoteDraft{Title: "ok", Markdown: strings.Repeat("a", MaxNoteMarkdownRunes+1)}, ModerationPending, ErrInvalidMarkdown},
		{"invalid moderation", NoteDraft{Title: "ok"}, Moderation("published"), ErrInvalidModeration},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := c.CreateNote("user-1", tt.draft, tt.moderation); !errors.Is(err, tt.want) {
				t.Fatalf("error = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestCreateNoteClampsPosition(t *testing.T) {
	c := New()

	note, err := c.CreateNote("user-1", NoteDraft{Title: "far", X: 999999, Y: -999999}, ModerationPending)
	if err != nil {
		t.Fatalf("CreateNote: %v", err)
	}

	if note.X > WorldWidth/2 || note.X < -WorldWidth/2 {
		t.Fatalf("X = %v out of world bounds", note.X)
	}
	if note.Y > WorldHeight/2 || note.Y < -WorldHeight/2 {
		t.Fatalf("Y = %v out of world bounds", note.Y)
	}
}

func TestUpdateNoteVersionConflict(t *testing.T) {
	c := New()
	note := mustCreate(t, c, "Hello")

	title := "Updated"
	updated, err := c.UpdateNote(note.ID, note.Version, NotePatch{Title: &title})
	if err != nil {
		t.Fatalf("UpdateNote: %v", err)
	}
	if updated.Title != title {
		t.Fatalf("Title = %q, want %q", updated.Title, title)
	}
	if updated.Version != note.Version+1 {
		t.Fatalf("Version = %d, want %d", updated.Version, note.Version+1)
	}

	if _, err := c.UpdateNote(note.ID, note.Version, NotePatch{Title: &title}); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale update error = %v, want ErrVersionConflict", err)
	}
}

func TestUpdateNoteValidationDoesNotMutate(t *testing.T) {
	c := New()
	note := mustCreate(t, c, "Hello")

	empty := ""
	if _, err := c.UpdateNote(note.ID, note.Version, NotePatch{Title: &empty}); !errors.Is(err, ErrInvalidTitle) {
		t.Fatalf("error = %v, want ErrInvalidTitle", err)
	}

	stored, _ := c.GetNote(note.ID)
	if stored.Title != "Hello" || stored.Version != note.Version {
		t.Fatalf("note mutated on failed update: %+v", stored)
	}
}

func TestMoveNote(t *testing.T) {
	c := New()
	note := mustCreate(t, c, "Hello")

	moved, err := c.MoveNote(note.ID, 100, 200)
	if err != nil {
		t.Fatalf("MoveNote: %v", err)
	}
	if moved.X != 100 || moved.Y != 200 {
		t.Fatalf("position = %v,%v, want 100,200", moved.X, moved.Y)
	}

	if _, err := c.MoveNote("ghost", 0, 0); !errors.Is(err, ErrNoteNotFound) {
		t.Fatalf("error = %v, want ErrNoteNotFound", err)
	}
}

func TestDeleteNoteCascadesEdges(t *testing.T) {
	c := New()
	first := mustCreate(t, c, "first")
	second := mustCreate(t, c, "second")

	edge, err := c.CreateEdge(first.ID, second.ID, RelationSupports, "")
	if err != nil {
		t.Fatalf("CreateEdge: %v", err)
	}

	if err := c.DeleteNote(second.ID); err != nil {
		t.Fatalf("DeleteNote: %v", err)
	}

	snapshot := c.Snapshot()
	if len(snapshot.Notes) != 1 {
		t.Fatalf("notes = %d, want 1", len(snapshot.Notes))
	}
	for _, remaining := range snapshot.Edges {
		if remaining.ID == edge.ID {
			t.Fatal("edge attached to a deleted note must be removed")
		}
	}
}

func TestModerateAndReveal(t *testing.T) {
	c := New()
	note := mustCreate(t, c, "Hello")

	if _, err := c.Reveal(note.ID, true); !errors.Is(err, ErrNoteNotApproved) {
		t.Fatalf("Reveal(pending) error = %v, want ErrNoteNotApproved", err)
	}

	approved, err := c.Moderate(note.ID, ModerationApproved)
	if err != nil {
		t.Fatalf("Moderate: %v", err)
	}

	revealed, err := c.Reveal(note.ID, true)
	if err != nil {
		t.Fatalf("Reveal: %v", err)
	}
	if !revealed.Visible {
		t.Fatal("note should be visible after Reveal")
	}
	if revealed.Version <= approved.Version {
		t.Fatal("Reveal must bump the version")
	}

	hidden, err := c.Reveal(note.ID, false)
	if err != nil {
		t.Fatalf("Hide: %v", err)
	}
	if hidden.Visible {
		t.Fatal("note should be hidden")
	}

	if _, err := c.Moderate(note.ID, ModerationPending); !errors.Is(err, ErrInvalidModeration) {
		t.Fatalf("Moderate(pending) error = %v, want ErrInvalidModeration", err)
	}
}

func TestModerateRejectHidesNote(t *testing.T) {
	c := New()
	note := mustCreate(t, c, "Hello")

	if _, err := c.Moderate(note.ID, ModerationApproved); err != nil {
		t.Fatalf("Moderate: %v", err)
	}
	if _, err := c.Reveal(note.ID, true); err != nil {
		t.Fatalf("Reveal: %v", err)
	}

	rejected, err := c.Moderate(note.ID, ModerationRejected)
	if err != nil {
		t.Fatalf("Moderate: %v", err)
	}
	if rejected.Visible {
		t.Fatal("a rejected note must not stay visible")
	}
}

func TestCreateEdgeValidation(t *testing.T) {
	c := New()
	first := mustCreate(t, c, "first")
	second := mustCreate(t, c, "second")

	tests := []struct {
		name     string
		from     string
		to       string
		relation Relation
		want     error
	}{
		{"invalid relation", first.ID, second.ID, Relation("likes"), ErrInvalidRelation},
		{"self link", first.ID, first.ID, RelationRelated, ErrInvalidEdge},
		{"missing target", first.ID, "ghost", RelationRelated, ErrNoteNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := c.CreateEdge(tt.from, tt.to, tt.relation, ""); !errors.Is(err, tt.want) {
				t.Fatalf("error = %v, want %v", err, tt.want)
			}
		})
	}
}

func TestCreateEdgeRejectsDuplicate(t *testing.T) {
	c := New()
	first := mustCreate(t, c, "first")
	second := mustCreate(t, c, "second")

	if _, err := c.CreateEdge(first.ID, second.ID, RelationSupports, ""); err != nil {
		t.Fatalf("first CreateEdge: %v", err)
	}
	if _, err := c.CreateEdge(first.ID, second.ID, RelationSupports, ""); !errors.Is(err, ErrDuplicateEdge) {
		t.Fatalf("duplicate error = %v, want ErrDuplicateEdge", err)
	}
	// A different relation between the same notes is allowed.
	if _, err := c.CreateEdge(first.ID, second.ID, RelationQuestions, ""); err != nil {
		t.Fatalf("second relation: %v", err)
	}
}

func TestDeleteEdge(t *testing.T) {
	c := New()
	first := mustCreate(t, c, "first")
	second := mustCreate(t, c, "second")

	edge, err := c.CreateEdge(first.ID, second.ID, RelationExtends, "why")
	if err != nil {
		t.Fatalf("CreateEdge: %v", err)
	}

	if err := c.DeleteEdge(edge.ID); err != nil {
		t.Fatalf("DeleteEdge: %v", err)
	}
	if err := c.DeleteEdge(edge.ID); !errors.Is(err, ErrEdgeNotFound) {
		t.Fatalf("second DeleteEdge error = %v, want ErrEdgeNotFound", err)
	}
}

func TestSnapshotIsACopy(t *testing.T) {
	c := New()
	note := mustCreate(t, c, "Hello")

	snapshot := c.Snapshot()
	if len(snapshot.Notes) != 1 || snapshot.Revision != c.Revision() {
		t.Fatalf("unexpected snapshot: %+v", snapshot)
	}

	snapshot.Notes[0].Title = "mutated"
	stored, _ := c.GetNote(note.ID)
	if stored.Title != "Hello" {
		t.Fatal("Snapshot must return copies, not internal pointers")
	}
}

func TestCanvasConcurrentAccess(t *testing.T) {
	c := New()

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			note, err := c.CreateNote("user", NoteDraft{Title: "note", X: 1, Y: 1}, ModerationPending)
			if err != nil {
				t.Errorf("CreateNote: %v", err)
				return
			}
			_, _ = c.MoveNote(note.ID, 2, 2)
			_ = c.Snapshot()
		}()
	}
	wg.Wait()

	if got := len(c.Snapshot().Notes); got != 50 {
		t.Fatalf("notes = %d, want 50", got)
	}
}
