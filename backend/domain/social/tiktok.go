package social

import (
	"context"
	"regexp"

	log "github.com/sirupsen/logrus"
	"github.com/steampoweredtaco/gotiktoklive"
)

type TiktokListener struct {
	tiktokService *gotiktoklive.TikTok
	messageFilter *regexp.Regexp
}

func (l *TiktokListener) SetMessageFilter(regex string) {
	l.messageFilter = regexp.MustCompile(regex)
}

func (l *TiktokListener) Connect(ctx context.Context, liveID string, message chan []byte) error {
	var err error
	l.tiktokService, err = gotiktoklive.NewTikTok()
	if err != nil {
		panic(err)
	}

	log.Info("Connected to tiktok")

	live, err := l.tiktokService.TrackUser("marc.gury.photographe")
	if err != nil {
		panic(err)
	}

	log.Info("Connected to user live")

	for {
		select {
		case <-ctx.Done():
			log.Info("Tiktok listener terminated...")
			return nil
		case event := <-live.Events:
			{
				switch e := event.(type) {
				// You can specify what to do for specific events. All events are listed below.
				case gotiktoklive.UserEvent:
					log.Infof("%T : %s %s\n", e, e.Event, e.User.Username)

				// List viewer count
				//case gotiktoklive.ViewersEvent:
				//log.Infof("%T : %d\n", e, e.Viewers)

				case gotiktoklive.ChatEvent:
					log.Infof("gotiktoklive.UserEvent : %v\n", e)

					// Specify the action for all remaining events
					//default:
					//log.Infof("%T : %+v\n", e, e)
				}
			}
		}
	}
}
