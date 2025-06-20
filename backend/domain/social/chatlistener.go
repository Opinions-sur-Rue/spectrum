package social

import (
	"context"
	"errors"
)

type ChatListener interface {
	Connect(ctx context.Context, liveID string, messageChannel chan []byte) error
	SetMessageFilter(regex string)
}

var (
	ErrUnknownServiceType = errors.New("unknown service type")
)

func CreateListener(serviceType string, regexMessageFilter string) (ChatListener, error) {
	var listener ChatListener
	switch serviceType {
	case "youtube":
		listener = &YoutubeListener{}
	case "tiktok":
		listener = &TiktokListener{}
	default:
		return nil, ErrUnknownServiceType
	}
	listener.SetMessageFilter(regexMessageFilter)
	return listener, nil
}
