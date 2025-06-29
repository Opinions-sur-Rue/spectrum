package social

import (
	"context"
	"regexp"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	twitch "github.com/gempir/go-twitch-irc/v4"
	log "github.com/sirupsen/logrus"
)

type TwitchListener struct {
	service          *twitch.Client
	messageFilter    *regexp.Regexp
	secret           string
	cancelConnection context.CancelFunc
}

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
	if l.cancelConnection != nil {
		l.cancelConnection()
	}
	return nil
}

func (l *TwitchListener) Connect(ctx context.Context, liveID string, messageChannel chan []byte) error {
	var err error
	var newCtx context.Context
	newCtx, l.cancelConnection = context.WithCancel(ctx)

	l.service = twitch.NewAnonymousClient()

	l.service.OnPrivateMessage(func(message twitch.PrivateMessage) {
		log.Debugf("[%s] %s", message.User.DisplayName, message.Message)

		reply := valueobjects.NewMessageContentWithArgs(valueobjects.RPC_LIVEUSERMESSAGE, message.User.ID, message.User.DisplayName, "", message.Message)
		messageChannel <- reply.Export()
	})

	l.service.Join(liveID)

	err = l.service.Connect()
	if err != nil {
		log.Fatal(err)
	}

	log.Infof("Live Chat ID: %s\n", liveID)

	<-newCtx.Done()
	log.Info("Twitch listener terminated...")
	err = l.service.Disconnect()
	if err != nil {
		log.Error(err)
	}

	l.cancelConnection = nil
	return nil
}
