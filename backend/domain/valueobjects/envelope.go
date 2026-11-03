package valueobjects

import (
	"encoding/json"
	"errors"
)

// ProtocolVersion is the version carried by v2 envelopes.
const ProtocolVersion = 2

var (
	ErrNotAnEnvelope    = errors.New("not a v2 envelope")
	ErrMissingOperation = errors.New("missing operation")
)

// Envelope is the structured message format introduced in v2. It lives next
// to the legacy {procedure, arguments} format on the same websocket so that
// v1 clients keep working during the migration.
type Envelope struct {
	V       int             `json:"v"`
	Op      string          `json:"op"`
	ID      string          `json:"id,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

// NewEnvelope builds a v2 envelope. A nil payload is omitted.
func NewEnvelope(op string, payload any) (*Envelope, error) {
	envelope := &Envelope{V: ProtocolVersion, Op: op}
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		envelope.Payload = raw
	}
	return envelope, nil
}

// ParseEnvelope strictly parses a v2 envelope. It returns ErrNotAnEnvelope
// when the payload is a legacy message.
func ParseEnvelope(data []byte) (*Envelope, error) {
	var envelope Envelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, err
	}
	if envelope.V != ProtocolVersion || envelope.Op == "" {
		return nil, ErrNotAnEnvelope
	}
	return &envelope, nil
}

// TryParseEnvelope parses a v2 envelope and reports whether the payload is
// one. Legacy messages return (nil, false) without an error.
func TryParseEnvelope(data []byte) (*Envelope, bool) {
	envelope, err := ParseEnvelope(data)
	if err != nil {
		return nil, false
	}
	return envelope, true
}

// DecodePayload unmarshals the payload into dst. A missing payload is not an
// error and leaves dst untouched.
func (e *Envelope) DecodePayload(dst any) error {
	if len(e.Payload) == 0 {
		return nil
	}
	return json.Unmarshal(e.Payload, dst)
}

// Export serialises the envelope for the wire.
func (e *Envelope) Export() []byte {
	raw, err := json.Marshal(e)
	if err != nil {
		return nil
	}
	return raw
}
