package social

type ChatListener interface {
	connect(liveID string) error
}

type LiveUserMessage struct {
	userID  string
	message string
}
