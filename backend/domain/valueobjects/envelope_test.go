package valueobjects

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestNewEnvelopeRoundTrip(t *testing.T) {
	envelope, err := NewEnvelope("ping", map[string]string{"hello": "world"})
	if err != nil {
		t.Fatalf("NewEnvelope: %v", err)
	}
	if envelope.V != ProtocolVersion {
		t.Fatalf("V = %d, want %d", envelope.V, ProtocolVersion)
	}

	parsed, err := ParseEnvelope(envelope.Export())
	if err != nil {
		t.Fatalf("ParseEnvelope: %v", err)
	}
	if parsed.Op != "ping" {
		t.Fatalf("Op = %q, want ping", parsed.Op)
	}

	var payload map[string]string
	if err := parsed.DecodePayload(&payload); err != nil {
		t.Fatalf("DecodePayload: %v", err)
	}
	if payload["hello"] != "world" {
		t.Fatalf("payload = %v, want hello=world", payload)
	}
}

func TestNewEnvelopeNilPayload(t *testing.T) {
	envelope, err := NewEnvelope("noop", nil)
	if err != nil {
		t.Fatalf("NewEnvelope: %v", err)
	}
	if envelope.Payload != nil {
		t.Fatalf("Payload = %s, want nil", envelope.Payload)
	}

	var dst map[string]string
	if err := envelope.DecodePayload(&dst); err != nil {
		t.Fatalf("DecodePayload on empty payload: %v", err)
	}
}

func TestParseEnvelopeRejectsLegacy(t *testing.T) {
	legacy := []byte(`{"procedure":"update","arguments":["431,582"]}`)

	if _, err := ParseEnvelope(legacy); !errors.Is(err, ErrNotAnEnvelope) {
		t.Fatalf("ParseEnvelope(legacy) error = %v, want ErrNotAnEnvelope", err)
	}
	if _, ok := TryParseEnvelope(legacy); ok {
		t.Fatal("TryParseEnvelope must reject legacy messages")
	}
}

func TestParseEnvelopeRejectsWrongVersion(t *testing.T) {
	raw := []byte(`{"v":1,"op":"ping"}`)

	if _, err := ParseEnvelope(raw); !errors.Is(err, ErrNotAnEnvelope) {
		t.Fatalf("ParseEnvelope(v1) error = %v, want ErrNotAnEnvelope", err)
	}
}

func TestParseEnvelopeRejectsMissingOp(t *testing.T) {
	raw := []byte(`{"v":2}`)

	if _, err := ParseEnvelope(raw); !errors.Is(err, ErrNotAnEnvelope) {
		t.Fatalf("ParseEnvelope(no op) error = %v, want ErrNotAnEnvelope", err)
	}
}

func TestEnvelopeExportIsValidJSON(t *testing.T) {
	envelope, err := NewEnvelope("note.create", struct {
		Title string `json:"title"`
	}{Title: "hello"})
	if err != nil {
		t.Fatalf("NewEnvelope: %v", err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(envelope.Export(), &decoded); err != nil {
		t.Fatalf("Export is not valid JSON: %v", err)
	}
	if decoded["v"] != float64(ProtocolVersion) {
		t.Fatalf("v = %v, want %d", decoded["v"], ProtocolVersion)
	}
}
