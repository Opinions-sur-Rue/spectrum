package spectrum

import "math"

type User struct {
	UserID               string
	Nickname             string
	Color                string
	currentRoomID        string
	lastPosition         string
	lastVoiceId          string
	microphoneEnabled    bool
	beginningGracePeriod int64
}

func NewUser(userID string) *User {
	return &User{
		UserID:               userID,
		lastVoiceId:          "",
		lastPosition:         "",
		microphoneEnabled:    false,
		beginningGracePeriod: math.MaxInt64 - 100,
	}
}

func (u *User) SetNickname(nickname string) {
	u.Nickname = nickname
}

func (u *User) SetRoom(roomID string) {
	u.currentRoomID = roomID
	if roomID == "" {
		u.beginningGracePeriod = math.MaxInt64 - 100
	}
}

func (u *User) SetLastPosition(lastPosition string) {
	u.lastPosition = lastPosition
}

func (u *User) LastPosition() string {
	if u.lastPosition != "" {
		return u.lastPosition
	}

	return "N,A" // Not applicable
}

func (u *User) SetLastVoiceId(lastVoiceId string) {
	u.lastVoiceId = lastVoiceId
}

func (u *User) LastVoiceId() string {
	return u.lastVoiceId
}

func (u *User) SetMicrophoneEnabled(enabled bool) {
	u.microphoneEnabled = enabled
}

func (u *User) MicrophoneEnabled() bool {
	return u.microphoneEnabled
}

func (u *User) Room() string {
	return u.currentRoomID
}

func (u *User) SetColor(color string) {
	u.Color = color
}

func (u *User) IsInRoom() bool {
	return u.currentRoomID != ""
}
