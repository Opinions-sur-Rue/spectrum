package valueobjects

type Message struct {
	sender    string
	recipient string
	content   []byte
}

func (m *Message) Sender() string {
	return m.sender
}

func (m *Message) Recipient() string {
	return m.recipient
}

func (m *Message) IsBroadcastMessage() bool {
	return m.recipient == ""
}

func (m *Message) IsServiceMessage() bool {
	return m.sender == ""
}

func (m *Message) Content() []byte {
	return m.content
}

func (m *Message) String() string {
	return string(m.content)
}

func NewMessage(sender string, recipient string, content []byte) *Message {
	return &Message{
		sender:    sender,
		recipient: recipient,
		content:   content,
	}
}

func NewBroadcastMessage(sender string, content []byte) *Message {
	return &Message{
		sender:  sender,
		content: content,
	}
}

func NewServiceMessage(recipient string, content []byte) *Message {
	return &Message{
		sender:    "",
		recipient: recipient,
		content:   content,
	}
}
