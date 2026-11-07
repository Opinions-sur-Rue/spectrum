package social

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	log "github.com/sirupsen/logrus"
	"github.com/steampoweredtaco/gotiktoklive"
)

type TiktokListener struct {
	mu               sync.Mutex
	onReady          func()
	tiktokService    *gotiktoklive.TikTok
	messageFilter    *regexp.Regexp
	secret           string
	cancelConnection context.CancelFunc
}

func (l *TiktokListener) SetOnReady(fn func()) { l.onReady = fn }

func (l *TiktokListener) GetType() string {
	return "tiktok"
}

func (l *TiktokListener) SetMessageFilter(regex string) {
	l.messageFilter = regexp.MustCompile(regex)
}

func (l *TiktokListener) SetSecret(secret string) {
	l.secret = secret
}

func (l *TiktokListener) Disconnect() error {
	l.mu.Lock()
	cancel := l.cancelConnection
	l.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func (l *TiktokListener) Connect(ctx context.Context, liveID string, onEvent OnEvent) error {
	newCtx, cancel := context.WithCancel(ctx)
	l.mu.Lock()
	l.cancelConnection = cancel
	l.mu.Unlock()
	defer func() { cancel(); l.mu.Lock(); l.cancelConnection = nil; l.mu.Unlock() }()

	if l.secret == "" || l.secret != os.Getenv("TIKTOK_SECRET") {
		log.Error("invalid tiktok secret")
		return errors.New("invalid tiktok secret")
	}

	var err error
	options := []gotiktoklive.TikTokLiveOption{}
	if signer := os.Getenv("SPECTRUM_TIKTOK_SIGNER_URL"); signer != "" {
		options = append(options, gotiktoklive.SigningUrl(signer))
	}
	l.tiktokService, err = gotiktoklive.NewTikTok(options...)
	if err != nil {
		return fmt.Errorf("failed to create TikTok client: %w", err)
	}

	log.Info("Connected to tiktok")

	live, err := l.tiktokService.TrackUser(liveID)
	if err != nil {
		return fmt.Errorf("failed to track TikTok user %q: %w", liveID, err)
	}
	defer live.Close()
	if newCtx.Err() != nil {
		return nil
	}
	if l.onReady != nil {
		l.onReady()
	}

	log.Info("Connected to user live")

	for {
		select {
		case <-newCtx.Done():
			log.Info("Tiktok listener terminated...")
			return nil
		case event, ok := <-live.Events:
			if !ok {
				return nil
			}
			{
				switch e := event.(type) {
				// You can specify what to do for specific events. All events are listed below.
				case gotiktoklive.UserEvent:
					reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERCONNECTED, strconv.FormatInt(e.User.ID, 10), e.User.Nickname)
					onEvent(reply)

				case gotiktoklive.ChatEvent:

					if !l.messageFilter.Match([]byte(strings.ToLower(e.Comment))) {
						continue
					}

					picture := ""
					if len(e.User.ProfilePicture.Urls) > 0 {
						picture = e.User.ProfilePicture.Urls[0]
					}
					reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, strconv.FormatInt(e.User.ID, 10), e.User.Nickname, picture, e.Comment)
					onEvent(reply)
				}
			}
		}
	}
}
