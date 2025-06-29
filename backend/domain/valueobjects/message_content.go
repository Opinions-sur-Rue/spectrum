package valueobjects

import (
	"encoding/json"

	log "github.com/sirupsen/logrus"
)

type MessageContent struct {
	Procedure string   `json:"procedure"`
	Arguments []string `json:"arguments,omitempty"`
}

const (
	RPC_ACK               = "ack"
	RPC_NACK              = "nack"
	RPC_USERLEFT          = "userleft"
	RPC_MADEADMIN         = "madeadmin"
	RPC_JOINED            = "joined"
	RPC_RECEIVE           = "receive"
	RPC_VOICECHAT         = "voicechat"
	RPC_MICROPHONEMUTED   = "microphonemuted"
	RPC_MICROPHONEUNMUTED = "microphoneunmuted"
	RPC_UPDATE            = "update"
	RPC_CLAIM             = "claim"
	RPC_LISTENNING        = "listenning"
	RPC_LIVEUSERCONNECTED = "liveuserconnected"
	RPC_LIVEUSERMESSAGE   = "liveusermessage"
	RPC_SPECTRUM          = "spectrum"
	RPC_NEWPOSITION       = "newposition"
	RPC_CHATMESSAGE       = "chatmessage"
)

func NewMessageContent(procedure string) *MessageContent {
	return &MessageContent{
		Procedure: procedure,
		Arguments: []string{},
	}
}

func NewMessageContentWithArgs(procedure string, args ...string) *MessageContent {
	return &MessageContent{
		Procedure: procedure,
		Arguments: args,
	}
}

func ParseMessageContent(jsonBytes []byte) (*MessageContent, error) {
	var content MessageContent
	log.Debug(string(jsonBytes))
	err := json.Unmarshal(jsonBytes, &content)
	if err != nil {
		log.Errorf("Failed to unmarshal message content: %v", err)
		return &MessageContent{}, err
	}
	return &content, nil
}

func (m *MessageContent) SetArguments(args ...string) {
	m.Arguments = args
}

func (m *MessageContent) Export() []byte {
	jsonBytes, err := json.Marshal(m)
	if err != nil {
		log.Errorf("Failed to marshal message content: %v", err)
		return nil
	}
	return jsonBytes
}
