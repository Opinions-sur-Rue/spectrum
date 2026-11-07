package social

import (
	"context"
	"fmt"
	"regexp"
	"sync"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	twitch "github.com/gempir/go-twitch-irc/v4"
	log "github.com/sirupsen/logrus"
)

type TwitchListener struct {
	mu               sync.Mutex
	onReady          func()
	service          *twitch.Client
	messageFilter    *regexp.Regexp
	secret           string
	cancelConnection context.CancelFunc
}

func (l *TwitchListener) SetOnReady(fn func()) { l.onReady = fn }

func (l *TwitchListener) GetType() string {
	return "twitch"
}

func (l *TwitchListener) SetMessageFilter(regex string) {
	l.messageFilter = regexp.MustCompile(regex)
}

func (l *TwitchListener) SetSecret(secret string) {
	l.secret = secret
}

func (l *TwitchListener) Disconnect() error {
	l.mu.Lock()
	cancel := l.cancelConnection
	l.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func (l *TwitchListener) Connect(ctx context.Context, liveID string, onEvent OnEvent) error {
	newCtx, cancel := context.WithCancel(ctx)
	l.mu.Lock()
	l.cancelConnection = cancel
	l.mu.Unlock()
	defer func() { cancel(); l.mu.Lock(); l.cancelConnection = nil; l.mu.Unlock() }()

	l.service = twitch.NewAnonymousClient()
	l.service.OnConnect(func() {
		if newCtx.Err() != nil {
			_ = l.service.Disconnect()
			return
		}
		if l.onReady != nil {
			l.onReady()
		}
	})

	l.service.OnPrivateMessage(func(message twitch.PrivateMessage) {
		if !l.messageFilter.MatchString(message.Message) {
			return
		}

		reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, message.User.ID, message.User.DisplayName, "", message.Message)
		onEvent(reply)
	})

	l.service.Join(liveID)

	done := make(chan error, 1)
	go func() { done <- l.service.Connect() }()
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("failed to connect to Twitch IRC: %w", err)
		}
		return nil
	case <-newCtx.Done():
		if err := l.service.Disconnect(); err != nil {
			log.Debug("Twitch listener disconnected")
		}
		return nil
	}
}
