package spectrum

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	log "github.com/sirupsen/logrus"
)

var ErrV2OperationNotRecognized = errors.New("v2 operation not recognized")

// v2Handler processes one structured operation received on the v2 channel.
type v2Handler func(c *Client, envelope *valueobjects.Envelope) error

// v2Handlers is the dispatch table for structured operations. Canvas, notes,
// transcript and facilitator operations are registered here as milestones
// land; M0 only ships the transport handshake.
var v2Handlers = map[string]v2Handler{
	"ping": handleV2Ping,
}

// EvaluateV2 routes a structured envelope to its handler.
func (c *Client) EvaluateV2(envelope *valueobjects.Envelope) error {
	if envelope == nil || envelope.Op == "" {
		return errors.Join(ErrV2OperationNotRecognized, fmt.Errorf("empty operation"))
	}

	log.Debug("V2 op " + envelope.Op)

	handler, ok := v2Handlers[envelope.Op]
	if !ok {
		return errors.Join(ErrV2OperationNotRecognized, fmt.Errorf("operation %s", envelope.Op))
	}

	return handler(c, envelope)
}

// SendV2 pushes a structured event to this client.
func (c *Client) SendV2(op string, payload any) {
	envelope, err := valueobjects.NewEnvelope(op, payload)
	if err != nil {
		log.Errorf("Failed to build v2 envelope %s: %v", op, err)
		return
	}

	raw := envelope.Export()
	if raw == nil {
		log.Errorf("Failed to export v2 envelope %s", op)
		return
	}

	c.send <- raw
}

type pongPayload struct {
	Echo json.RawMessage `json:"echo,omitempty"`
	At   int64           `json:"at"`
}

func handleV2Ping(c *Client, envelope *valueobjects.Envelope) error {
	c.SendV2("pong", pongPayload{
		Echo: envelope.Payload,
		At:   time.Now().UnixMilli(),
	})
	return nil
}
