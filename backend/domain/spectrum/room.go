package spectrum

import (
	cryptorand "crypto/rand"
	"errors"
	"math/rand"
	"slices"

	canvasdomain "Opinions-sur-Rue/spectrum/domain/canvas"
	"Opinions-sur-Rue/spectrum/domain/social"
	log "github.com/sirupsen/logrus"
)

var generalColors = []string{
	"e5130a",
	"e5783e",
	"e5d450",
	"92e550",
	"51cde2",
	"5950e5",
	"ad50e5",
	"4e4c4e",
}

type Room struct {
	id                    string
	topic                 string
	password              string
	closed                bool
	admins                []string
	participants          map[string]*User
	spectators            map[string]*User
	memberIDs             map[string]string
	spectrumRevision      uint64
	chatMessages          []chatMessage
	chatSequence          uint64
	raisedHands           map[string]int64
	reactionLastSent      map[string]int64
	transcript            []transcriptSegment
	transcriptSequence    uint64
	transcriptionConsents map[string]uint64
	browserTranscripts    map[string]*browserTranscriptSession
	voiceRoomID           string
	voiceGeneration       uint64
	settings              RoomSettings
	board                 *canvasdomain.Canvas
	socialListener        social.ChatListener
	live                  *liveSession
	showNeutralCircle     bool
	sliceCount            int
	participantsHidden    bool
}

func (r *Room) ShowNeutralCircle() bool {
	return r.showNeutralCircle
}

func (r *Room) SliceCount() int {
	if r.sliceCount == 0 {
		return 7
	}
	return r.sliceCount
}

func (r *Room) Join(newUser *User) error {
	if r.closed {
		return errors.New("room closed")
	}
	newUser.SetRoom(r.password)
	return nil
}

func NewRoom(creator *User, id string, topic string) *Room {
	creator.SetRoom(id)
	return &Room{
		id:                id,
		topic:             topic,
		closed:            false,
		admins:            []string{creator.UserID},
		participants:      make(map[string]*User),
		spectators:        make(map[string]*User),
		memberIDs:         make(map[string]string),
		settings:          LoadRoomSettings(),
		showNeutralCircle: true,
		board:             canvasdomain.New(),
	}
}

func (r *Room) Leave(color string) error {
	if r == nil || r.closed {
		return errors.New("room closed")
	}

	if member := r.participants[color]; member != nil {
		delete(r.raisedHands, member.UserID)
		delete(r.reactionLastSent, member.UserID)
	}
	delete(r.participants, color)
	r.spectrumRevision++

	return nil
}

func (r *Room) RoomID() string {
	return r.id
}

func (r *Room) SetTopic(topic string) {
	r.topic = topic
	r.spectrumRevision++
}

func (r *Room) Topic() string {
	return r.topic
}

func (r *Room) SetPassword(password string) error {
	if r.closed {
		return errors.New("room closed")
	}
	r.password = password
	return nil
}

func (r *Room) AddUser(user *User) (string, error) {
	if r.closed {
		return "", errors.New("room closed")
	}

	if r.ParticipantSlots() <= len(r.participants) {
		return "", ErrRoomFull
	}

	// Generate a slice containing colorIndices from 0 to n-1
	colorIndices := make([]int, len(generalColors))
	for i := 0; i < len(generalColors); i++ {
		colorIndices[i] = i
	}

	var color string

	for len(colorIndices) != 0 {
		x := rand.Intn(len(colorIndices))
		candidate := generalColors[colorIndices[x]]

		if _, alreadyPresent := r.participants[candidate]; alreadyPresent {
			// color already taken
			colorIndices = append(colorIndices[:x], colorIndices[x+1:]...)
		} else {
			r.participants[candidate] = user
			user.SetColor(candidate)
			color = candidate
			break
		}
	}

	if color == "" {
		return "", ErrRoomFull
	}
	r.ensureMemberID(user.UserID)
	r.spectrumRevision++

	return color, nil
}

// --- Stage model (v2) ---

// Settings returns the current room settings.
func (r *Room) Settings() RoomSettings {
	return r.settings
}

// Board returns the room canvas. It is never nil for a room built with NewRoom.
func (r *Room) Board() *canvasdomain.Canvas {
	return r.board
}

// SetSettings replaces the room settings after clamping them.
func (r *Room) SetSettings(settings RoomSettings) {
	r.settings = settings.Sanitize()
	r.spectrumRevision++
}

// ParticipantSlots returns the number of seats on stage.
func (r *Room) ParticipantSlots() int {
	if r.settings.ParticipantSlots <= 0 {
		return DefaultParticipantSlots
	}
	return r.settings.ParticipantSlots
}

// SpectatorLimit returns the number of seats on the bench.
func (r *Room) SpectatorLimit() int {
	if r.settings.SpectatorLimit <= 0 {
		return DefaultSpectatorLimit
	}
	return r.settings.SpectatorLimit
}

// RoleOf returns the role of a member and whether they belong to the room.
func (r *Room) RoleOf(userID string) (Role, bool) {
	if r == nil {
		return RoleSpectator, false
	}

	for _, participant := range r.participants {
		if participant.UserID == userID {
			if slices.Contains(r.admins, userID) {
				return RoleAdmin, true
			}
			return RoleParticipant, true
		}
	}

	if _, ok := r.spectators[userID]; ok {
		return RoleSpectator, true
	}

	return RoleSpectator, false
}

// ColorOf returns the pellet color of a participant.
func (r *Room) ColorOf(userID string) (string, bool) {
	for color, participant := range r.participants {
		if participant.UserID == userID {
			return color, true
		}
	}
	return "", false
}

// MemberCount returns the number of users in the room, stage and bench.
func (r *Room) MemberCount() int {
	return len(r.participants) + len(r.spectators)
}

// Participants returns the users currently on stage.
func (r *Room) Participants() []*User {
	users := make([]*User, 0, len(r.participants))
	for _, participant := range r.participants {
		users = append(users, participant)
	}
	return users
}

// Spectators returns the users currently on the bench.
func (r *Room) Spectators() []*User {
	users := make([]*User, 0, len(r.spectators))
	for _, spectator := range r.spectators {
		users = append(users, spectator)
	}
	return users
}

// AddSpectator puts a user on the bench. It is idempotent.
func (r *Room) AddSpectator(user *User) error {
	if r == nil || r.closed {
		return ErrRoomClosed
	}
	if user == nil {
		return ErrUserCannotJoin
	}
	if _, already := r.spectators[user.UserID]; already {
		return nil
	}
	if _, onStage := r.ColorOf(user.UserID); onStage {
		return nil
	}
	if len(r.spectators) >= r.SpectatorLimit() {
		return ErrSpectatorLimitReached
	}

	r.spectators[user.UserID] = user
	r.ensureMemberID(user.UserID)
	user.SetColor("")
	user.SetLastPosition("")
	user.SetRoom(r.id)
	r.spectrumRevision++

	return nil
}

// RemoveSpectator takes a user off the bench. It reports whether they were there.
func (r *Room) RemoveSpectator(userID string) bool {
	if r == nil {
		return false
	}
	if _, ok := r.spectators[userID]; !ok {
		return false
	}
	delete(r.spectators, userID)
	delete(r.raisedHands, userID)
	delete(r.reactionLastSent, userID)
	r.spectrumRevision++
	return true
}

// Promote moves a spectator onto the stage and returns their pellet color.
func (r *Room) Promote(userID string) (string, error) {
	if r == nil || r.closed {
		return "", ErrRoomClosed
	}

	user, ok := r.spectators[userID]
	if !ok {
		return "", ErrUserNotOnBench
	}

	color, err := r.AddUser(user)
	if err != nil {
		return "", err
	}

	delete(r.spectators, userID)

	return color, nil
}

// Demote moves a participant back to the bench and releases their slot.
func (r *Room) Demote(userID string) error {
	if r == nil || r.closed {
		return ErrRoomClosed
	}

	color, ok := r.ColorOf(userID)
	if !ok {
		return ErrUserNotOnStage
	}

	// Check the bench before mutating anything, so a failed demotion is a no-op.
	if _, already := r.spectators[userID]; !already && len(r.spectators) >= r.SpectatorLimit() {
		return ErrSpectatorLimitReached
	}

	participant := r.participants[color]
	delete(r.participants, color)
	r.RemoveAdmin(userID)

	participant.SetColor("")
	participant.SetMicrophoneEnabled(false)
	participant.SetLastVoiceId("")
	participant.SetLastPosition("")
	participant.SetRoom(r.id)
	r.spectrumRevision++

	if _, already := r.spectators[userID]; !already {
		r.spectators[userID] = participant
	}

	return nil
}

// Public IDs are scoped to this ephemeral room. Never expose the signin ID.
func (r *Room) ensureMemberID(userID string) {
	if r.memberIDs == nil {
		r.memberIDs = make(map[string]string)
	}
	if r.memberIDs[userID] == "" {
		r.memberIDs[userID] = "m_" + cryptorand.Text()
	}
}

func (r *Room) userIDForMember(memberID string) (string, bool) {
	for userID, publicID := range r.memberIDs {
		if publicID == memberID {
			_, present := r.RoleOf(userID)
			return userID, present
		}
	}
	return "", false
}

func (r *Room) SetAdminByColor(color string) error {
	if r.closed {
		return errors.New("room closed")
	}
	if _, ok := r.participants[color]; !ok {
		return errors.New("user not found")
	}

	r.admins = append(r.admins, r.participants[color].UserID)
	r.spectrumRevision++
	r.participants[color].SetLastPosition("")
	return nil
}

func (r *Room) SetAdmin(user *User) error {
	if r.closed {
		return errors.New("room closed")
	}
	r.admins = append(r.admins, user.UserID)
	r.spectrumRevision++
	user.SetLastPosition("")
	return nil
}

func (r *Room) IsAdmin(userID string) bool {
	if r.closed {
		return false
	}

	return slices.Contains(r.admins, userID)
}

func (r *Room) RemoveAdmin(userID string) {
	for i, adminID := range r.admins {
		if adminID == userID {
			r.admins = append(r.admins[:i], r.admins[i+1:]...)
			r.spectrumRevision++
			return
		}
	}
}

func (r *Room) Close() error {
	if r.closed {
		return errors.New("room closed")
	}

	r.closed = true
	r.cancelLive()

	if r.SocialListener() != nil {
		err := r.SocialListener().Disconnect()
		if err != nil {
			log.Error("could not disconnect room social listener")
		}
		r.socialListener = nil
	}

	return nil
}

func (r *Room) IsClosed() bool {
	return r.closed
}

func (r *Room) SocialListener() social.ChatListener {
	return r.socialListener
}

func (r *Room) SetSocialListener(listener social.ChatListener) {
	r.socialListener = listener
}
