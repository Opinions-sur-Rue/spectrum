package social

import (
	"context"
	"errors"
)

type ChatListener interface {
	Connect(ctx context.Context, liveID string, messageChannel chan []byte) error
	Disconnect() error
	SetMessageFilter(regex string)
	SetSecret(secret string)
}

var (
	ErrUnknownServiceType = errors.New("unknown service type")
)

func CreateListener(serviceType string, regexMessageFilter string, secret string) (ChatListener, error) {
	var listener ChatListener
	switch serviceType {
	case "youtube":
		listener = &YoutubeListener{}
	case "tiktok":
		listener = &TiktokListener{}
	case "twitch":
		listener = &TwitchListener{}
	default:
		return nil, ErrUnknownServiceType
	}
	listener.SetMessageFilter(regexMessageFilter)
	listener.SetSecret(secret)
	return listener, nil
}
