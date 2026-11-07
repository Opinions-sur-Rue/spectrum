package social

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	log "github.com/sirupsen/logrus"
	"google.golang.org/api/option"
	"google.golang.org/api/youtube/v3"
)

type YoutubeListener struct {
	mu               sync.Mutex
	onReady          func()
	service          *youtube.Service
	messageFilter    *regexp.Regexp
	secret           string
	cancelConnection context.CancelFunc
}

func (l *YoutubeListener) SetOnReady(fn func()) { l.onReady = fn }

func (l *YoutubeListener) GetType() string {
	return "youtube"
}

func (l *YoutubeListener) SetMessageFilter(regex string) {
	l.messageFilter = regexp.MustCompile(regex)
}

func (l *YoutubeListener) SetSecret(secret string) {
	l.secret = secret
}

func (l *YoutubeListener) Disconnect() error {
	l.mu.Lock()
	cancel := l.cancelConnection
	l.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return nil
}

func (l *YoutubeListener) Connect(ctx context.Context, liveID string, onEvent OnEvent) error {
	var err error
	newCtx, cancel := context.WithCancel(ctx)
	l.mu.Lock()
	l.cancelConnection = cancel
	l.mu.Unlock()
	defer func() { cancel(); l.mu.Lock(); l.cancelConnection = nil; l.mu.Unlock() }()

	if l.service == nil {
		l.service, err = youtube.NewService(newCtx, option.WithAPIKey(l.secret))
		if err != nil {
			return errors.Join(errors.New("error while creating YouTube service"), err)
		}
	}

	call := l.service.Videos.List([]string{"liveStreamingDetails"}).Id(liveID).Context(newCtx)
	response, err := call.Do()
	if err != nil {
		return errors.Join(errors.New("error while getting video details"), err)
	}

	if len(response.Items) == 0 {
		return errors.New("error live not found")
	}

	if response.Items[0].LiveStreamingDetails == nil {
		return errors.New("live has no streaming details")
	}
	liveChatID := response.Items[0].LiveStreamingDetails.ActiveLiveChatId
	if liveChatID == "" {
		return errors.New("error live has no chat")
	}

	if l.onReady != nil {
		l.onReady()
	}

	nextPageToken := ""
	var delay time.Duration = 0
	for {
		select {
		case <-newCtx.Done():
			log.Info("YouTube listener terminated...")
			return nil
		case <-time.After(delay * time.Millisecond):
			chatCall := l.service.LiveChatMessages.List(liveChatID, []string{"snippet", "authorDetails"}).Context(newCtx)
			if nextPageToken != "" {
				chatCall.PageToken(nextPageToken)
			}

			chatResponse, err := chatCall.Do()
			if err != nil {
				if newCtx.Err() != nil {
					return nil
				}
				log.Warn("YouTube chat polling failed")
				delay = 5000
				continue
			}

			for _, item := range chatResponse.Items {
				if item.AuthorDetails == nil || item.Snippet == nil {
					continue
				}
				author := item.AuthorDetails.DisplayName
				message := item.Snippet.DisplayMessage

				if !l.messageFilter.Match([]byte(strings.ToLower(message))) {
					continue
				}

				reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, item.AuthorDetails.ChannelId, author, item.AuthorDetails.ProfileImageUrl, message)
				onEvent(reply)
			}

			nextPageToken = chatResponse.NextPageToken
			d := chatResponse.PollingIntervalMillis
			if d == 0 {
				delay = 5000 // default value 5 seconds
			} else {
				delay = time.Duration(d)
			}
		}
	}
}
