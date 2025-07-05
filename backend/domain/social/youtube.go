package social

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	log "github.com/sirupsen/logrus"
	"google.golang.org/api/option"
	"google.golang.org/api/youtube/v3"
)

type YoutubeListener struct {
	service          *youtube.Service
	messageFilter    *regexp.Regexp
	secret           string
	cancelConnection context.CancelFunc
}

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
	if l.cancelConnection != nil {
		l.cancelConnection()
	}
	return nil
}

func (l *YoutubeListener) Connect(ctx context.Context, liveID string, onEvent OnEvent) error {
	var err error
	var newCtx context.Context
	newCtx, l.cancelConnection = context.WithCancel(ctx)

	if l.service == nil {
		l.service, err = youtube.NewService(newCtx, option.WithAPIKey(l.secret))
		if err != nil {
			return errors.Join(errors.New("error while creating YouTube service"), err)
		}
	}

	call := l.service.Videos.List([]string{"liveStreamingDetails"}).Id(liveID)
	response, err := call.Do()
	if err != nil {
		return errors.Join(errors.New("error while getting video details"), err)
	}

	if len(response.Items) == 0 {
		return errors.New("error live not found")
	}

	liveChatID := response.Items[0].LiveStreamingDetails.ActiveLiveChatId
	if liveChatID == "" {
		return errors.New("error live has no chat")
	}

	log.Infof("Live Chat ID: %s\n", liveChatID)

	nextPageToken := ""
	var delay time.Duration = 0
	for {
		select {
		case <-newCtx.Done():
			log.Info("YouTube listener terminated...")
			l.cancelConnection = nil
			return nil
		case <-time.After(delay * time.Millisecond):
			chatCall := l.service.LiveChatMessages.List(liveChatID, []string{"snippet", "authorDetails"})
			if nextPageToken != "" {
				chatCall.PageToken(nextPageToken)
			}

			chatResponse, err := chatCall.Do()
			if err != nil {
				log.Printf("error while getting chat message: %v", err)
				time.Sleep(5 * time.Second)
				continue
			}

			for _, item := range chatResponse.Items {
				author := item.AuthorDetails.DisplayName
				message := item.Snippet.DisplayMessage
				log.Debugf("[%s] %s\n", author, message)

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
