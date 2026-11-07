package spectrum

import (
	"context"
	"crypto/rand"
	"errors"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"Opinions-sur-Rue/spectrum/domain/social"
	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

const liveUserLimit = 1000
const liveSelectionLimit = 20
const liveDisconnected = "disconnected"

var liveVotePattern = regexp.MustCompile(`(?i)^\s*spectrum\s+(-?[0-4]|i)\s*$`)
var liveChannelPattern = regexp.MustCompile(`^[a-zA-Z0-9_@.\-]{1,100}$`)
var errLiveRequest = errors.New("invalid live request or live connection unavailable")

type liveUser struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Vote     *int   `json:"vote"`
	Selected bool   `json:"selected"`
}
type liveSession struct {
	platform string
	status   string
	cancel   context.CancelFunc
	users    map[string]*liveUser // platform IDs never leave the server
	changed  *time.Timer
}
type liveSnapshot struct {
	Revision        uint64     `json:"revision"`
	RoomID          string     `json:"roomId"`
	Platform        string     `json:"platform,omitempty"`
	Status          string     `json:"status"`
	Count           int        `json:"count"`
	Limit           int        `json:"limit"`
	Users           []liveUser `json:"users"`
	TikTokAvailable bool       `json:"tiktokAvailable"`
}

func init() {
	v2Handlers["live.get"] = handleLiveGet
	v2Handlers["live.connect"] = handleLiveConnect
	v2Handlers["live.disconnect"] = handleLiveDisconnect
	v2Handlers["live.select"] = handleLiveSelect
}

// Called under hub lock. Cancellation never performs network I/O.
func (r *Room) cancelLive() {
	if r.live != nil {
		r.live.cancel()
		if r.live.changed != nil {
			r.live.changed.Stop()
		}
		r.live = nil
		r.spectrumRevision++
	}
}

func (h *Hub) shutdownLive() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, room := range h.rooms {
		room.cancelLive()
	}
}

func (r *Room) liveFor(role Role) liveSnapshot {
	state := liveSnapshot{RoomID: r.id, Status: liveDisconnected, Limit: liveUserLimit, Users: []liveUser{}}
	state.Revision = r.spectrumRevision
	state.TikTokAvailable = os.Getenv("SPECTRUM_TIKTOK_SIGNER_URL") != ""
	if r.live == nil {
		return state
	}
	state.Status, state.Platform, state.Count = r.live.status, r.live.platform, len(r.live.users)
	if role == RoleAdmin {
		for _, user := range r.live.users {
			state.Users = append(state.Users, *user)
		}
		sort.Slice(state.Users, func(i, j int) bool { return state.Users[i].ID < state.Users[j].ID })
	}
	return state
}

func handleLiveGet(c *Client, envelope *valueobjects.Envelope) error {
	_, roomID, _, _, _, err := c.v2RoomContext()
	var state liveSnapshot
	if err == nil {
		present := false
		c.hub.WithRoomRead(roomID, func(room *Room) {
			role, member := room.RoleOf(c.userID)
			present = member
			if member {
				state = room.liveFor(role)
			}
		})
		if !present {
			err = ErrNotInRoom
		}
	}
	if err != nil {
		c.v2Error(envelope, "live_unavailable", err)
		return err
	}
	c.SendV2("live.snapshot", state)
	return nil
}

func handleLiveConnect(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		Platform string `json:"platform"`
		Channel  string `json:"channel"`
		Secret   string `json:"secret"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "live_invalid_request", errLiveRequest)
		return err
	}
	_, roomID, role, _, _, err := c.v2RoomContext()
	if err == nil && role != RoleAdmin {
		err = ErrForbidden
	}
	if err == nil && (!liveChannelPattern.MatchString(payload.Channel) || len(payload.Secret) > 4096) {
		err = errLiveRequest
	}
	if err == nil && payload.Platform == "tiktok" && os.Getenv("SPECTRUM_TIKTOK_SIGNER_URL") == "" {
		err = errLiveRequest
	}
	factory := c.hub.liveFactory
	if factory == nil {
		factory = social.CreateListener
	}
	var listener social.ChatListener
	if err == nil {
		listener, err = factory(payload.Platform, liveVotePattern.String(), payload.Secret)
	}
	if err != nil {
		c.v2Error(envelope, "live_invalid_request", errLiveRequest)
		return err
	}
	ctx := c.hub.context
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithCancel(ctx)
	session := &liveSession{platform: payload.Platform, status: "connecting", cancel: cancel, users: make(map[string]*liveUser)}
	err = c.hub.WithRoom(roomID, func(room *Room) error {
		if !room.IsAdmin(c.userID) {
			return ErrForbidden
		}
		if room.live != nil || room.SocialListener() != nil {
			return errLiveRequest
		}
		room.live = session
		room.spectrumRevision++
		return nil
	})
	if err != nil {
		cancel()
		c.v2Error(envelope, "live_invalid_request", errLiveRequest)
		return err
	}
	if notifying, ok := listener.(interface{ SetOnReady(func()) }); ok {
		notifying.SetOnReady(func() { c.hub.liveReady(roomID, session) })
	}
	c.hub.MessageRoomV2(roomID, "live.invalidate", struct{}{}, nil)
	go c.hub.runLive(ctx, roomID, payload.Channel, session, listener)
	return nil
}

func (h *Hub) runLive(ctx context.Context, roomID, channel string, session *liveSession, listener social.ChatListener) {
	defer session.cancel()
	err := listener.Connect(ctx, channel, func(event *valueobjects.MessageContent) { h.ingestLive(roomID, session, event) })
	_ = h.WithRoom(roomID, func(room *Room) error {
		if room.live != session || ctx.Err() != nil {
			return nil
		}
		if err != nil {
			session.status = "error"
		} else {
			session.status = liveDisconnected
		}
		room.spectrumRevision++
		h.scheduleLiveLocked(room, session)
		return nil
	})
}

func (h *Hub) liveReady(roomID string, session *liveSession) {
	_ = h.WithRoom(roomID, func(room *Room) error {
		if room.live == session && session.status == "connecting" {
			session.status = "connected"
			room.spectrumRevision++
			h.scheduleLiveLocked(room, session)
		}
		return nil
	})
}

func handleLiveDisconnect(c *Client, envelope *valueobjects.Envelope) error {
	return changeLive(c, envelope, func(room *Room) error { room.cancelLive(); return nil })
}

func handleLiveSelect(c *Client, envelope *valueobjects.Envelope) error {
	var payload struct {
		ID       string `json:"id"`
		Selected bool   `json:"selected"`
	}
	if err := envelope.DecodePayload(&payload); err != nil {
		c.v2Error(envelope, "live_invalid_request", errLiveRequest)
		return err
	}
	return changeLive(c, envelope, func(room *Room) error {
		if room.live == nil {
			return errLiveRequest
		}
		selected := 0
		var target *liveUser
		for _, user := range room.live.users {
			if user.Selected {
				selected++
			}
			if user.ID == payload.ID {
				target = user
			}
		}
		if target == nil || (payload.Selected && !target.Selected && selected >= liveSelectionLimit) {
			return errLiveRequest
		}
		target.Selected = payload.Selected
		room.spectrumRevision++
		return nil
	})
}

func changeLive(c *Client, envelope *valueobjects.Envelope, mutate func(*Room) error) error {
	_, roomID, _, _, _, err := c.v2RoomContext()
	if err == nil {
		err = c.hub.WithRoom(roomID, func(room *Room) error {
			if !room.IsAdmin(c.userID) {
				return ErrForbidden
			}
			return mutate(room)
		})
	}
	if err != nil {
		c.v2Error(envelope, "live_invalid_request", errLiveRequest)
		return err
	}
	c.hub.MessageRoomV2(roomID, "room.invalidate", struct{}{}, nil)
	return nil
}

func (h *Hub) ingestLive(roomID string, session *liveSession, event *valueobjects.MessageContent) {
	if event == nil || event.Procedure != valueobjects.RPC_LIVEUSERMESSAGE || len(event.Arguments) < 4 {
		return
	}
	parts := liveVotePattern.FindStringSubmatch(event.Arguments[3])
	if parts == nil || event.Arguments[0] == "" || len(event.Arguments[0]) > 256 {
		return
	}
	_ = h.WithRoom(roomID, func(room *Room) error {
		if room.live != session || session.status == "error" || session.status == liveDisconnected {
			return nil
		}
		var vote *int
		if strings.ToLower(parts[1]) != "i" {
			n, _ := strconv.Atoi(parts[1])
			if math.Abs(float64(n)) > float64((room.SliceCount()-1)/2) {
				return nil
			}
			vote = &n
		}
		user := session.users[event.Arguments[0]]
		if user == nil {
			if len(session.users) >= liveUserLimit {
				return nil
			}
			user = &liveUser{ID: "l_" + rand.Text()}
			session.users[event.Arguments[0]] = user
		}
		name := []rune(strings.TrimSpace(event.Arguments[1]))
		if len(name) > 40 {
			name = name[:40]
		}
		if !utf8.ValidString(event.Arguments[1]) {
			return nil
		}
		user.Nickname, user.Vote = string(name), vote
		if user.Nickname == "" {
			user.Nickname = "Guest"
		}
		session.status = "connected"
		room.spectrumRevision++
		h.scheduleLiveLocked(room, session)
		return nil
	})
}

// Bound external-event fan-out to four refreshes per second per room.
func (h *Hub) scheduleLiveLocked(room *Room, session *liveSession) {
	if session.changed != nil {
		return
	}
	roomID := room.id
	session.changed = time.AfterFunc(250*time.Millisecond, func() {
		h.mu.Lock()
		current := h.rooms[roomID]
		valid := current == room && room.live == session
		if valid {
			session.changed = nil
		}
		h.mu.Unlock()
		if valid {
			h.MessageRoomV2(roomID, "live.invalidate", struct{}{}, nil)
			h.MessageRoomV2(roomID, "spectrum.invalidate", struct{}{}, nil)
		}
	})
}

func (r *Room) livePellets() []pelletPayload {
	result := []pelletPayload{}
	if r.live == nil {
		return result
	}
	total, count := 0, 0
	max := (r.SliceCount() - 1) / 2
	for _, user := range r.live.users {
		valid := user.Vote != nil && *user.Vote >= -max && *user.Vote <= max
		if valid {
			total += *user.Vote
			count++
		}
		if user.Selected {
			x, y := 490.0, 450.0
			if valid {
				x, y = liveVotePosition(float64(*user.Vote), r.SliceCount())
			}
			result = append(result, pelletPayload{MemberID: user.ID, Nickname: user.Nickname, Color: "9146ff", X: x, Y: y, Version: r.spectrumRevision})
		}
	}
	if len(r.live.users) > 0 {
		x, y := 490.0, 450.0
		if count > 0 {
			x, y = liveVotePosition(math.Round(float64(total)/float64(count)), r.SliceCount())
		}
		result = append(result, pelletPayload{MemberID: "live_average", Nickname: r.live.platform, Color: "9146ff", X: x, Y: y, Version: r.spectrumRevision})
	}
	return result
}

func liveVotePosition(vote float64, slices int) (float64, float64) {
	theta := math.Pi/2 - vote*math.Pi/float64(slices-1)
	return 490 + 415*math.Cos(theta), 450 - 370*math.Sin(theta)
}
