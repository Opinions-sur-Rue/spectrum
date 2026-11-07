// Package voice owns the self-hosted SFU boundary. Application identity and
// private signin IDs never leave the spectrum backend.
package voice

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/livekit/protocol/auth"
)

const Namespace = "spectrum_"

var ErrUnavailable = errors.New("voice service unavailable")
var ErrUnsafeConfiguration = errors.New("LiveKit must disable automatic room creation")

type Backend interface {
	Prepare(context.Context) error
	CreateRoom(context.Context, string) error
	DeleteRoom(context.Context, string) error
	JoinToken(string, string, bool) (string, error)
	PublicURL() string
}

type Config struct{ InternalURL, URL, Key, Secret string }
type Client struct {
	config   Config
	http     *http.Client
	mu       sync.Mutex
	prepared bool
}

func FromEnv() (Backend, error) {
	if os.Getenv("SPECTRUM_VOICE_ENABLED") != "true" {
		return nil, nil
	}
	return ConfiguredFromEnv()
}

// Disabled deployments still clean abandoned rooms when SFU credentials exist.
func ConfiguredFromEnv() (Backend, error) {
	client, err := New(Config{InternalURL: os.Getenv("LIVEKIT_INTERNAL_URL"), URL: os.Getenv("LIVEKIT_PUBLIC_URL"), Key: os.Getenv("LIVEKIT_API_KEY"), Secret: os.Getenv("LIVEKIT_API_SECRET")})
	if err != nil {
		return nil, err
	}
	return client, nil
}

func New(config Config) (*Client, error) {
	internal, err := url.Parse(config.InternalURL)
	if err != nil || internal.Host == "" || internal.User != nil || internal.RawQuery != "" || (internal.Scheme != "http" && internal.Scheme != "https") {
		return nil, ErrUnavailable
	}
	public, err := url.Parse(config.URL)
	if err != nil || public.Host == "" || public.User != nil || (public.Scheme != "ws" && public.Scheme != "wss") {
		return nil, ErrUnavailable
	}
	if public.Scheme == "ws" && public.Hostname() != "localhost" {
		ip := net.ParseIP(public.Hostname())
		if ip == nil || !ip.IsLoopback() {
			return nil, ErrUnavailable
		}
	}
	if config.Key == "" || len(config.Secret) < 32 {
		return nil, ErrUnavailable
	}
	config.InternalURL = strings.TrimRight(config.InternalURL, "/")
	return &Client{config: config, http: &http.Client{Timeout: 3 * time.Second}}, nil
}

func (c *Client) PublicURL() string { return c.config.URL }

func (c *Client) JoinToken(room, identity string, publish bool) (string, error) {
	if !strings.HasPrefix(room, Namespace) || identity == "" {
		return "", ErrUnavailable
	}
	grant := &auth.VideoGrant{RoomJoin: true, Room: room}
	grant.SetCanSubscribe(true)
	grant.SetCanPublish(publish)
	grant.SetCanPublishData(false)
	grant.SetCanUpdateOwnMetadata(false)
	if publish {
		grant.CanPublishSources = []string{"microphone"}
	}
	return auth.NewAccessToken(c.config.Key, c.config.Secret).SetIdentity(identity).SetName(identity).SetVideoGrant(grant).SetValidFor(2 * time.Minute).ToJWT()
}

// Prepare checks the critical admission invariant and removes abandoned rooms
// from the previous (single authoritative backend) process before issuing tokens.
func (c *Client) Prepare(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.prepared {
		return nil
	}
	probeRoom := Namespace + "probe_" + rand.Text()
	token, err := c.JoinToken(probeRoom, "probe", false)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.config.InternalURL+"/rtc/validate?protocol=16", nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := c.http.Do(request)
	if err != nil {
		return ErrUnavailable
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		return ErrUnsafeConfiguration
	}
	var list struct {
		Rooms []struct {
			Name string `json:"name"`
		} `json:"rooms"`
	}
	if err := c.call(ctx, "ListRooms", map[string]any{}, &list); err != nil {
		return err
	}
	for _, room := range list.Rooms {
		if strings.HasPrefix(room.Name, Namespace) {
			if err := c.DeleteRoom(ctx, room.Name); err != nil {
				return err
			}
		}
	}
	c.prepared = true
	return nil
}

func (c *Client) CreateRoom(ctx context.Context, room string) error {
	if !strings.HasPrefix(room, Namespace) {
		return ErrUnavailable
	}
	// Keep a service slot beyond the six stage members and fifty spectators.
	return c.call(ctx, "CreateRoom", map[string]any{"name": room, "emptyTimeout": 60, "departureTimeout": 10, "maxParticipants": 57}, nil)
}

func (c *Client) DeleteRoom(ctx context.Context, room string) error {
	if !strings.HasPrefix(room, Namespace) {
		return ErrUnavailable
	}
	return c.call(ctx, "DeleteRoom", map[string]string{"room": room}, nil)
}

func (c *Client) call(ctx context.Context, method string, payload, output any) error {
	grant := &auth.VideoGrant{RoomCreate: true, RoomList: true}
	token, err := auth.NewAccessToken(c.config.Key, c.config.Secret).SetVideoGrant(grant).SetValidFor(30 * time.Second).ToJWT()
	if err != nil {
		return ErrUnavailable
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.config.InternalURL+"/twirp/livekit.RoomService/"+method, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return ErrUnavailable
	}
	defer response.Body.Close()
	if method == "DeleteRoom" && response.StatusCode == http.StatusNotFound {
		return nil
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("LiveKit %s failed (%d)", method, response.StatusCode)
	}
	if output != nil {
		return json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(output)
	}
	return nil
}
