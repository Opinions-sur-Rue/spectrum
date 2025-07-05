package social

import (
	"context"
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	log "github.com/sirupsen/logrus"
	"github.com/steampoweredtaco/gotiktoklive"
)

type TiktokListener struct {
	tiktokService    *gotiktoklive.TikTok
	messageFilter    *regexp.Regexp
	secret           string
	cancelConnection context.CancelFunc
}

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
	if l.cancelConnection != nil {
		l.cancelConnection()
	}
	return nil
}

func (l *TiktokListener) Connect(ctx context.Context, liveID string, onEvent OnEvent) error {
	var newCtx context.Context
	newCtx, l.cancelConnection = context.WithCancel(ctx)

	if l.secret == "" || l.secret != os.Getenv("TIKTOK_SECRET") {
		log.Error("invalid tiktok secret")
		return errors.New("invalid tiktok secret")
	}

	var err error
	l.tiktokService, err = gotiktoklive.NewTikTok()
	if err != nil {
		panic(err)
	}

	log.Info("Connected to tiktok")

	live, err := l.tiktokService.TrackUser(liveID)
	if err != nil {
		panic(err)
	}

	log.Info("Connected to user live")

	for {
		select {
		case <-newCtx.Done():
			log.Info("Tiktok listener terminated...")
			l.cancelConnection = nil
			return nil
		case event := <-live.Events:
			{
				switch e := event.(type) {
				// You can specify what to do for specific events. All events are listed below.
				case gotiktoklive.UserEvent:
					log.Infof("%T : %s %s", e, e.Event, e.User.Nickname)
					reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERCONNECTED, strconv.FormatInt(e.User.ID, 10), e.User.Nickname)
					onEvent(reply)

				case gotiktoklive.ChatEvent:
					log.Debugf("gotiktoklive.ChatEvent : %v\n", e)

					if !l.messageFilter.Match([]byte(strings.ToLower(e.Comment))) {
						continue
					}

					reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, strconv.FormatInt(e.User.ID, 10), e.User.Nickname, e.User.ProfilePicture.Urls[0], e.Comment)
					onEvent(reply)
				}
			}
		}
	}
}
