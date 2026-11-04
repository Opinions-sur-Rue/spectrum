// Package canvas holds the v2 workspace state: notes placed around the
// spectrum and the typed links between them.
//
// The canvas is ephemeral, like the rest of the room: it lives in memory and
// is dropped when the room closes. The type is safe for concurrent use; the
// Hub does not need to hold its own lock to call it.
package canvas

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"math"
	"strings"
	"sync"
	"time"
)

const (
	// WorldWidth and WorldHeight bound the infinite canvas. The world is
	// centred on the origin, so coordinates live in [-W/2, W/2].
	WorldWidth  = 12000.0
	WorldHeight = 8000.0

	// SpectrumWidth and SpectrumHeight are the fixed spectrum zone at the
	// origin. The spectrum cannot be moved or resized in v2.
	SpectrumWidth  = 980.0
	SpectrumHeight = 735.0

	// MaxNoteTitleRunes and MaxNoteMarkdownRunes bound a note payload.
	MaxNoteTitleRunes    = 80
	MaxNoteMarkdownRunes = 4000

	// DefaultNoteWidth and DefaultNoteHeight are the initial note size.
	DefaultNoteWidth  = 360.0
	DefaultNoteHeight = 340.0
	MinNoteWidth      = 220.0
	MinNoteHeight     = 140.0
	MaxNoteWidth      = 1200.0
	MaxNoteHeight     = 1200.0
)

// Err* are the domain errors returned by the canvas.
var (
	ErrNoteNotFound      = errors.New("note not found")
	ErrEdgeNotFound      = errors.New("edge not found")
	ErrVersionConflict   = errors.New("note version conflict")
	ErrInvalidTitle      = errors.New("invalid note title")
	ErrInvalidMarkdown   = errors.New("invalid note markdown")
	ErrInvalidRelation   = errors.New("invalid edge relation")
	ErrInvalidEdge       = errors.New("invalid edge")
	ErrDuplicateEdge     = errors.New("edge already exists")
	ErrNoteNotApproved   = errors.New("note is not approved")
	ErrInvalidModeration = errors.New("invalid moderation state")
	ErrNotePinned        = errors.New("note is pinned; unpin it before changing its layout")
	ErrInvalidNoteSize   = errors.New("invalid note size")
)

// Moderation is the review state of a note, independent from its visibility.
type Moderation string

const (
	ModerationPending  Moderation = "pending"
	ModerationApproved Moderation = "approved"
	ModerationRejected Moderation = "rejected"
)

// IsValid reports whether the moderation state is known.
func (m Moderation) IsValid() bool {
	switch m {
	case ModerationPending, ModerationApproved, ModerationRejected:
		return true
	default:
		return false
	}
}

// Relation is the semantic type of an edge between two notes.
type Relation string

const (
	RelationSupports    Relation = "supports"
	RelationContradicts Relation = "contradicts"
	RelationQuestions   Relation = "questions"
	RelationExtends     Relation = "extends"
	RelationRelated     Relation = "related"
)

// IsValid reports whether the relation is known.
func (r Relation) IsValid() bool {
	switch r {
	case RelationSupports, RelationContradicts, RelationQuestions, RelationExtends, RelationRelated:
		return true
	default:
		return false
	}
}

// Note is a card placed on the canvas.
type Note struct {
	ID         string     `json:"id"`
	X          float64    `json:"x"`
	Y          float64    `json:"y"`
	Width      float64    `json:"width"`
	Height     float64    `json:"height"`
	Z          int        `json:"z"`
	Title      string     `json:"title"`
	Markdown   string     `json:"markdown"`
	Color      string     `json:"color"`
	AuthorID   string     `json:"authorId"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	Version    int        `json:"version"`
	Moderation Moderation `json:"moderation"`
	Visible    bool       `json:"visible"`
	Pinned     bool       `json:"pinned"`
}

// Edge is a typed link between two notes.
type Edge struct {
	ID       string   `json:"id"`
	From     string   `json:"from"`
	To       string   `json:"to"`
	Relation Relation `json:"relation"`
	Label    string   `json:"label"`
	Version  int      `json:"version"`
}

// Snapshot is the full canvas state sent to a client on join.
type Snapshot struct {
	Revision int64  `json:"revision"`
	Notes    []Note `json:"notes"`
	Edges    []Edge `json:"edges"`
}

// NoteDraft is the input of CreateNote.
type NoteDraft struct {
	Title    string
	Markdown string
	Color    string
	X        float64
	Y        float64
}

// NotePatch is a partial update of an editable note.
type NotePatch struct {
	Title    *string
	Markdown *string
	Color    *string
}

// Canvas is the in-memory workspace of a room.
type Canvas struct {
	mu       sync.RWMutex
	notes    map[string]*Note
	edges    map[string]*Edge
	revision int64
	nextZ    int
}

// New returns an empty canvas.
func New() *Canvas {
	return &Canvas{
		notes: make(map[string]*Note),
		edges: make(map[string]*Edge),
	}
}

// Revision returns the monotonic revision counter.
func (c *Canvas) Revision() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.revision
}

// CreateNote adds a note in the given moderation state and returns a copy.
func (c *Canvas) CreateNote(authorID string, draft NoteDraft, moderation Moderation) (Note, error) {
	if !moderation.IsValid() {
		return Note{}, ErrInvalidModeration
	}

	title := strings.TrimSpace(draft.Title)
	if err := validateTitle(title); err != nil {
		return Note{}, err
	}
	if err := validateMarkdown(draft.Markdown); err != nil {
		return Note{}, err
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now().UTC()
	x, y := clampPosition(draft.X, draft.Y, DefaultNoteWidth, DefaultNoteHeight)

	note := &Note{
		ID:         newID(),
		X:          x,
		Y:          y,
		Width:      DefaultNoteWidth,
		Height:     DefaultNoteHeight,
		Z:          c.nextZ,
		Title:      title,
		Markdown:   draft.Markdown,
		Color:      draft.Color,
		AuthorID:   authorID,
		CreatedAt:  now,
		UpdatedAt:  now,
		Version:    1,
		Moderation: moderation,
		Visible:    false,
	}

	c.notes[note.ID] = note
	c.nextZ++
	c.revision++

	return *note, nil
}

// UpdateNote applies a patch if the supplied version is current.
func (c *Canvas) UpdateNote(id string, version int, patch NotePatch) (Note, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	note, ok := c.notes[id]
	if !ok {
		return Note{}, ErrNoteNotFound
	}
	if note.Version != version {
		return Note{}, ErrVersionConflict
	}

	if patch.Title != nil {
		title := strings.TrimSpace(*patch.Title)
		if err := validateTitle(title); err != nil {
			return Note{}, err
		}
	}
	if patch.Markdown != nil {
		if err := validateMarkdown(*patch.Markdown); err != nil {
			return Note{}, err
		}
	}
	if patch.Title != nil {
		note.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Markdown != nil {
		note.Markdown = *patch.Markdown
	}
	if patch.Color != nil {
		note.Color = *patch.Color
	}

	note.UpdatedAt = time.Now().UTC()
	note.Version++
	c.revision++

	return *note, nil
}

// MoveNote repositions a note. Dragging does not require a version check:
// it is a low-stakes, last-write-wins operation.
func (c *Canvas) MoveNote(id string, x float64, y float64) (Note, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	note, ok := c.notes[id]
	if !ok {
		return Note{}, ErrNoteNotFound
	}
	if note.Pinned {
		return Note{}, ErrNotePinned
	}

	note.X, note.Y = clampPosition(x, y, note.Width, note.Height)
	note.UpdatedAt = time.Now().UTC()
	c.revision++

	return *note, nil
}

// ResizeNote changes layout without invalidating an in-progress text edit.
func (c *Canvas) ResizeNote(id string, width, height float64) (Note, error) {
	if math.IsNaN(width) || math.IsNaN(height) || math.IsInf(width, 0) || math.IsInf(height, 0) || width <= 0 || height <= 0 {
		return Note{}, ErrInvalidNoteSize
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	note, ok := c.notes[id]
	if !ok {
		return Note{}, ErrNoteNotFound
	}
	if note.Pinned {
		return Note{}, ErrNotePinned
	}
	note.Width = math.Min(math.Max(MinNoteWidth, math.Min(MaxNoteWidth, width)), WorldWidth/2-note.X)
	note.Height = math.Min(math.Max(MinNoteHeight, math.Min(MaxNoteHeight, height)), WorldHeight/2-note.Y)
	note.UpdatedAt = time.Now().UTC()
	c.revision++
	return *note, nil
}

// PinNote changes movement protection without changing the content version.
// Pin and MoveNote share the mutex, so a concurrent move cannot bypass pinning.
func (c *Canvas) PinNote(id string, pinned bool) (Note, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	note, ok := c.notes[id]
	if !ok {
		return Note{}, ErrNoteNotFound
	}
	note.Pinned = pinned
	note.UpdatedAt = time.Now().UTC()
	c.revision++
	return *note, nil
}

// DeleteNote removes a note and every edge attached to it.
func (c *Canvas) DeleteNote(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if _, ok := c.notes[id]; !ok {
		return ErrNoteNotFound
	}
	delete(c.notes, id)

	for edgeID, edge := range c.edges {
		if edge.From == id || edge.To == id {
			delete(c.edges, edgeID)
		}
	}

	c.revision++
	return nil
}

// Moderate moves a note to approved or rejected.
func (c *Canvas) Moderate(id string, decision Moderation) (Note, error) {
	if decision != ModerationApproved && decision != ModerationRejected {
		return Note{}, ErrInvalidModeration
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	note, ok := c.notes[id]
	if !ok {
		return Note{}, ErrNoteNotFound
	}

	note.Moderation = decision
	note.UpdatedAt = time.Now().UTC()
	note.Version++
	if decision == ModerationRejected {
		note.Visible = false
	}
	c.revision++

	return *note, nil
}

// Reveal shows or hides an approved note. A note must be approved before it
// can be revealed.
func (c *Canvas) Reveal(id string, visible bool) (Note, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	note, ok := c.notes[id]
	if !ok {
		return Note{}, ErrNoteNotFound
	}
	if note.Moderation != ModerationApproved {
		return Note{}, ErrNoteNotApproved
	}

	note.Visible = visible
	note.UpdatedAt = time.Now().UTC()
	note.Version++
	c.revision++

	return *note, nil
}

// GetNote returns a copy of a note.
func (c *Canvas) GetNote(id string) (Note, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	note, ok := c.notes[id]
	if !ok {
		return Note{}, false
	}
	return *note, true
}

// CreateEdge links two notes.
func (c *Canvas) CreateEdge(from string, to string, relation Relation, label string) (Edge, error) {
	if !relation.IsValid() {
		return Edge{}, ErrInvalidRelation
	}
	if from == "" || to == "" || from == to {
		return Edge{}, ErrInvalidEdge
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if _, ok := c.notes[from]; !ok {
		return Edge{}, ErrNoteNotFound
	}
	if _, ok := c.notes[to]; !ok {
		return Edge{}, ErrNoteNotFound
	}

	for _, existing := range c.edges {
		if existing.From == from && existing.To == to && existing.Relation == relation {
			return Edge{}, ErrDuplicateEdge
		}
	}

	edge := &Edge{
		ID:       newID(),
		From:     from,
		To:       to,
		Relation: relation,
		Label:    label,
		Version:  1,
	}

	c.edges[edge.ID] = edge
	c.revision++

	return *edge, nil
}

// DeleteEdge removes a link.
func (c *Canvas) DeleteEdge(id string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if _, ok := c.edges[id]; !ok {
		return ErrEdgeNotFound
	}
	delete(c.edges, id)
	c.revision++

	return nil
}

// Snapshot returns a deep copy of the whole canvas.
func (c *Canvas) Snapshot() Snapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()

	snapshot := Snapshot{
		Revision: c.revision,
		Notes:    make([]Note, 0, len(c.notes)),
		Edges:    make([]Edge, 0, len(c.edges)),
	}

	for _, note := range c.notes {
		snapshot.Notes = append(snapshot.Notes, *note)
	}
	for _, edge := range c.edges {
		snapshot.Edges = append(snapshot.Edges, *edge)
	}

	return snapshot
}

func validateTitle(title string) error {
	if title == "" {
		return ErrInvalidTitle
	}
	if len([]rune(title)) > MaxNoteTitleRunes {
		return ErrInvalidTitle
	}
	return nil
}

func validateMarkdown(markdown string) error {
	if len([]rune(markdown)) > MaxNoteMarkdownRunes {
		return ErrInvalidMarkdown
	}
	return nil
}

func clampPosition(x float64, y float64, width float64, height float64) (float64, float64) {
	halfWidth := WorldWidth / 2
	halfHeight := WorldHeight / 2

	x = math.Max(-halfWidth, math.Min(halfWidth-width, x))
	y = math.Max(-halfHeight, math.Min(halfHeight-height, y))

	return x, y
}

func newID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand should not fail; fall back to a timestamp-based id.
		return "note-" + time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(buf)
}
