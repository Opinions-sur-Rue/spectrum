package social

import (
	"context"
	"errors"
)

type ChatListener interface {
	connect(ctx context.Context, liveID string, messageChannel chan []byte) error
}

var (
	ErrUnknownServiceType = errors.New("unknown service type")
)

func CreateListener(serviceType string) (ChatListener, error) {
	switch serviceType {
	case "youtube":
		return &YoutubeListener{}, nil
	case "tiktok":
		return &TiktokListener{}, nil
	default:
		return nil, ErrUnknownServiceType
	}
}
