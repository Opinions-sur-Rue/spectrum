package social

import (
	"context"
	"errors"
	"time"

	log "github.com/sirupsen/logrus"
	"google.golang.org/api/option"
	"google.golang.org/api/youtube/v3"
)

type YoutubeListener struct {
	service *youtube.Service
}

func (l *YoutubeListener) connect(ctx context.Context, liveID string, message chan []byte) error {
	var err error

	if l.service == nil {
		l.service, err = youtube.NewService(ctx, option.WithAPIKey("AIzaSyA8HLfFVlV1bTVZgqtdl3BMrettSqROlK8"))
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
		case <-ctx.Done():
			log.Info("Hub runner terminated...")
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
				//item.AuthorDetails.ProfileImageUrl
				//item.AuthorDetails.ChannelId
				author := item.AuthorDetails.DisplayName
				message := item.Snippet.DisplayMessage
				log.Infof("[%s] %s\n", author, message)
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
