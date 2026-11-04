package spectrum

import (
	"errors"

	canvasdomain "Opinions-sur-Rue/spectrum/domain/canvas"
	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	log "github.com/sirupsen/logrus"
)

var (
	ErrNotSignedIn = errors.New("client is not signed in")
	ErrNotInRoom   = errors.New("client is not in a room")
	ErrForbidden   = errors.New("operation not allowed for this role")
)

// --- Payloads ---

type noteCreatePayload struct {
	Markdown string  `json:"markdown"`
	Color    string  `json:"color"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
}

type noteUpdatePayload struct {
	NoteID   string  `json:"noteId"`
	Version  int     `json:"version"`
	Markdown *string `json:"markdown,omitempty"`
	Color    *string `json:"color,omitempty"`
}

type noteMovePayload struct {
	NoteID string  `json:"noteId"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
}

type noteResizePayload struct {
	NoteID string  `json:"noteId"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type noteIDPayload struct {
	NoteID string `json:"noteId"`
}

type noteModeratePayload struct {
	NoteID   string `json:"noteId"`
	Decision string `json:"decision"`
}

type noteRevealPayload struct {
	NoteID  string `json:"noteId"`
	Visible bool   `json:"visible"`
}

type notePinPayload struct {
	NoteID string `json:"noteId"`
	Pinned bool   `json:"pinned"`
}

type edgeCreatePayload struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Relation string `json:"relation"`
	Label    string `json:"label"`
}

type edgeIDPayload struct {
	EdgeID string `json:"edgeId"`
}

type errorPayload struct {
	RequestID string `json:"requestId,omitempty"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}

func init() {
	v2Handlers["canvas.get"] = handleCanvasGet
	v2Handlers["note.create"] = handleNoteCreate
	v2Handlers["note.update"] = handleNoteUpdate
	v2Handlers["note.move"] = handleNoteMove
	v2Handlers["note.resize"] = handleNoteResize
	v2Handlers["note.pin"] = handleNotePin
	v2Handlers["note.delete"] = handleNoteDelete
	v2Handlers["note.moderate"] = handleNoteModerate
	v2Handlers["note.reveal"] = handleNoteReveal
	v2Handlers["edge.create"] = handleEdgeCreate
	v2Handlers["edge.delete"] = handleEdgeDelete
}

// --- Handlers ---

func handleCanvasGet(c *Client, envelope *valueobjects.Envelope) error {
	user, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}

	snapshot := board.Snapshot()
	filtered := canvasdomain.Snapshot{Revision: snapshot.Revision}
	visible := make(map[string]bool, len(snapshot.Notes))

	for _, note := range snapshot.Notes {
		if canSeeNote(user.UserID, role, settings, note) {
			filtered.Notes = append(filtered.Notes, c.publicNote(roomID, note))
			visible[note.ID] = true
		}
	}
	for _, edge := range snapshot.Edges {
		if visible[edge.From] && visible[edge.To] {
			filtered.Edges = append(filtered.Edges, edge)
		}
	}

	c.SendV2("canvas.snapshot", filtered)
	return nil
}

func handleNoteCreate(c *Client, envelope *valueobjects.Envelope) error {
	var payload noteCreatePayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}

	user, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	if !role.CanProposeNotes() {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}

	moderation := canvasdomain.ModerationPending
	if role.CanModerate() {
		moderation = canvasdomain.ModerationApproved
	}

	note, err := board.CreateNote(user.UserID, canvasdomain.NoteDraft{
		Title:    canvasdomain.TitleFromMarkdown(payload.Markdown),
		Markdown: payload.Markdown,
		Color:    payload.Color,
		X:        payload.X,
		Y:        payload.Y,
	}, moderation)
	if err != nil {
		c.v2Error(envelope, "invalid_note", err)
		return err
	}

	c.hub.MessageRoomV2(roomID, "note.created", c.publicNote(roomID, note), noteAudience(settings, note))

	return nil
}

func handleNoteUpdate(c *Client, envelope *valueobjects.Envelope) error {
	var payload noteUpdatePayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}

	user, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}

	existing, ok := board.GetNote(payload.NoteID)
	if !ok {
		c.v2Error(envelope, "note_not_found", canvasdomain.ErrNoteNotFound)
		return canvasdomain.ErrNoteNotFound
	}
	if !canEditNote(user.UserID, role, existing) {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}

	var title *string
	if payload.Markdown != nil {
		derived := canvasdomain.TitleFromMarkdown(*payload.Markdown)
		title = &derived
	}
	note, err := board.UpdateNote(payload.NoteID, payload.Version, canvasdomain.NotePatch{
		Title:    title,
		Markdown: payload.Markdown,
		Color:    payload.Color,
	})
	if err != nil {
		c.v2Error(envelope, "invalid_update", err)
		return err
	}

	c.hub.MessageRoomV2(roomID, "note.updated", c.publicNote(roomID, note), noteAudience(settings, note))

	return nil
}

func handleNoteMove(c *Client, envelope *valueobjects.Envelope) error {
	var payload noteMovePayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}

	user, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}

	existing, ok := board.GetNote(payload.NoteID)
	if !ok {
		c.v2Error(envelope, "note_not_found", canvasdomain.ErrNoteNotFound)
		return canvasdomain.ErrNoteNotFound
	}
	if !canEditNote(user.UserID, role, existing) {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}

	note, err := board.MoveNote(payload.NoteID, payload.X, payload.Y)
	if err != nil {
		c.v2Error(envelope, "invalid_move", err)
		return err
	}

	c.hub.MessageRoomV2(roomID, "note.moved", c.publicNote(roomID, note), noteAudience(settings, note))

	return nil
}

func handleNoteResize(c *Client, envelope *valueobjects.Envelope) error {
	var payload noteResizePayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	user, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	existing, ok := board.GetNote(payload.NoteID)
	if !ok {
		c.v2Error(envelope, "note_not_found", canvasdomain.ErrNoteNotFound)
		return canvasdomain.ErrNoteNotFound
	}
	if !canEditNote(user.UserID, role, existing) {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}
	note, err := board.ResizeNote(payload.NoteID, payload.Width, payload.Height)
	if err != nil {
		c.v2Error(envelope, "invalid_resize", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "note.resized", c.publicNote(roomID, note), noteAudience(settings, note))
	return nil
}

func handleNotePin(c *Client, envelope *valueobjects.Envelope) error {
	var payload notePinPayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}
	user, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	existing, ok := board.GetNote(payload.NoteID)
	if !ok {
		c.v2Error(envelope, "note_not_found", canvasdomain.ErrNoteNotFound)
		return canvasdomain.ErrNoteNotFound
	}
	if !canEditNote(user.UserID, role, existing) {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}
	note, err := board.PinNote(payload.NoteID, payload.Pinned)
	if err != nil {
		c.v2Error(envelope, "invalid_pin", err)
		return err
	}
	c.hub.MessageRoomV2(roomID, "note.pinned", c.publicNote(roomID, note), noteAudience(settings, note))
	return nil
}

func handleNoteDelete(c *Client, envelope *valueobjects.Envelope) error {
	var payload noteIDPayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}

	user, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}

	existing, ok := board.GetNote(payload.NoteID)
	if !ok {
		c.v2Error(envelope, "note_not_found", canvasdomain.ErrNoteNotFound)
		return canvasdomain.ErrNoteNotFound
	}
	if !canEditNote(user.UserID, role, existing) {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}

	if err := board.DeleteNote(payload.NoteID); err != nil {
		c.v2Error(envelope, "invalid_delete", err)
		return err
	}

	audience := noteAudience(settings, existing)
	c.hub.MessageRoomV2(roomID, "note.deleted", noteIDPayload{NoteID: payload.NoteID}, audience)

	return nil
}

func handleNoteModerate(c *Client, envelope *valueobjects.Envelope) error {
	var payload noteModeratePayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}

	_, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	if !role.CanModerate() {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}

	note, err := board.Moderate(payload.NoteID, canvasdomain.Moderation(payload.Decision))
	if err != nil {
		c.v2Error(envelope, "invalid_moderation", err)
		return err
	}

	c.hub.MessageRoomV2(roomID, "note.moderated", c.publicNote(roomID, note), noteAudience(settings, note))
	// Members who lost access must discard cached notes and incident edges.
	c.hub.MessageRoomV2(roomID, "canvas.invalidate", struct{}{}, nil)

	return nil
}

func handleNoteReveal(c *Client, envelope *valueobjects.Envelope) error {
	var payload noteRevealPayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}

	_, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	if !role.CanModerate() {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}

	note, err := board.Reveal(payload.NoteID, payload.Visible)
	if err != nil {
		c.v2Error(envelope, "invalid_reveal", err)
		return err
	}

	c.hub.MessageRoomV2(roomID, "note.revealed", c.publicNote(roomID, note), noteAudience(settings, note))
	// Also refresh members excluded from the new audience (hide), and expose
	// existing edges to newly eligible members (reveal).
	c.hub.MessageRoomV2(roomID, "canvas.invalidate", struct{}{}, nil)

	return nil
}

func handleEdgeCreate(c *Client, envelope *valueobjects.Envelope) error {
	var payload edgeCreatePayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}

	_, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	if !role.CanModerate() {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}

	edge, err := board.CreateEdge(payload.From, payload.To, canvasdomain.Relation(payload.Relation), payload.Label)
	if err != nil {
		c.v2Error(envelope, "invalid_edge", err)
		return err
	}

	c.hub.MessageRoomV2(roomID, "edge.created", edge, edgeAudience(settings, board, edge))

	return nil
}

func handleEdgeDelete(c *Client, envelope *valueobjects.Envelope) error {
	var payload edgeIDPayload
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "invalid_payload", err)
		return err
	}

	_, roomID, role, settings, board, err := c.v2RoomContext()
	if err != nil {
		c.v2Error(envelope, "not_in_room", err)
		return err
	}
	if !role.CanModerate() {
		c.v2Error(envelope, "forbidden", ErrForbidden)
		return ErrForbidden
	}

	// Resolve the endpoints before deleting so the audience can be computed.
	var audience func(userID string, role Role) bool
	for _, edge := range board.Snapshot().Edges {
		if edge.ID == payload.EdgeID {
			audience = edgeAudience(settings, board, edge)
			break
		}
	}

	if err := board.DeleteEdge(payload.EdgeID); err != nil {
		c.v2Error(envelope, "invalid_delete", err)
		return err
	}

	c.hub.MessageRoomV2(roomID, "edge.deleted", payload, audience)

	return nil
}

// --- Helpers ---

func (c *Client) publicNote(roomID string, note canvasdomain.Note) canvasdomain.Note {
	authorID := note.AuthorID
	note.AuthorID = ""
	c.hub.WithRoomRead(roomID, func(room *Room) { note.AuthorID = room.memberIDs[authorID] })
	return note
}

func (c *Client) v2RoomContext() (*User, string, Role, RoomSettings, *canvasdomain.Canvas, error) {
	if c.userID == "" {
		return nil, "", "", RoomSettings{}, nil, ErrNotSignedIn
	}

	user := c.hub.GetUser(c.userID)
	if user == nil || !user.IsInRoom() {
		return nil, "", "", RoomSettings{}, nil, ErrNotInRoom
	}

	roomID := user.Room()

	var role Role
	var settings RoomSettings
	var board *canvasdomain.Canvas
	var member bool

	c.hub.WithRoomRead(roomID, func(room *Room) {
		role, member = room.RoleOf(user.UserID)
		settings = room.Settings()
		board = room.Board()
	})

	if board == nil {
		return nil, "", "", RoomSettings{}, nil, ErrRoomNotFound
	}
	if !member {
		return nil, "", "", RoomSettings{}, nil, ErrNotInRoom
	}

	return user, roomID, role, settings, board, nil
}

func (c *Client) v2Error(envelope *valueobjects.Envelope, code string, err error) {
	log.Debugf("v2 %s failed (%s): %v", envelope.Op, code, err)
	c.SendV2("error", errorPayload{
		RequestID: envelope.ID,
		Code:      code,
		Message:   err.Error(),
	})
}

// canSeeNote reports whether a room member may receive a note.
func canSeeNote(userID string, role Role, settings RoomSettings, note canvasdomain.Note) bool {
	if role == RoleAdmin {
		return true
	}

	// The audience only ever sees approved notes that the admin revealed.
	// This applies to spectators without exception, including a demoted
	// participant who authored the note.
	if role == RoleSpectator {
		return note.Moderation == canvasdomain.ModerationApproved &&
			note.Visible &&
			settings.NotesVisibleToSpectators
	}

	// On stage: authors keep sight of their own notes through moderation.
	if note.AuthorID == userID {
		return true
	}

	return note.Moderation == canvasdomain.ModerationApproved && note.Visible
}

// canEditNote reports whether a room member may edit or move a note.
// Admins can edit anything; authors can only edit notes that are not approved.
func canEditNote(userID string, role Role, note canvasdomain.Note) bool {
	if role == RoleAdmin {
		return true
	}
	return role == RoleParticipant && note.AuthorID == userID && note.Moderation != canvasdomain.ModerationApproved
}

func noteAudience(settings RoomSettings, note canvasdomain.Note) func(string, Role) bool {
	return func(userID string, role Role) bool {
		return canSeeNote(userID, role, settings, note)
	}
}

func edgeAudience(settings RoomSettings, board *canvasdomain.Canvas, edge canvasdomain.Edge) func(string, Role) bool {
	return func(userID string, role Role) bool {
		if role == RoleAdmin {
			return true
		}

		// Read the endpoints at call time: their visibility changes while the
		// edge exists (reveal, moderation).
		from, okFrom := board.GetNote(edge.From)
		to, okTo := board.GetNote(edge.To)
		if !okFrom || !okTo {
			return false
		}

		return canSeeNote(userID, role, settings, from) && canSeeNote(userID, role, settings, to)
	}
}
