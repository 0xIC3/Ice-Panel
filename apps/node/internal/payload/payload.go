// Package payload decodes the base64url JSON blob the panel issues on
// `POST /api/nodes`. The shape mirrors the panel's NodePayload (see
// `apps/panel-backend/src/modules/keygen/keygen.service.ts`).
package payload

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

// Payload is the agent's identity material — issued once at node creation
// and stored on the node-agent host.
type Payload struct {
	NodeCertPem string `json:"nodeCertPem"`
	NodeKeyPem  string `json:"nodeKeyPem"`
	CACertPem   string `json:"caCertPem"`
}

// Decode parses a base64url-encoded JSON Payload. The panel uses
// Node's `Buffer.toString('base64url')` which omits padding, so we
// accept both raw URL-safe and standard URL-safe encodings.
func Decode(b64url string) (*Payload, error) {
	raw, err := base64.RawURLEncoding.DecodeString(b64url)
	if err != nil {
		// Fall back to padded URL-safe in case the source padded the blob.
		raw, err = base64.URLEncoding.DecodeString(b64url)
		if err != nil {
			return nil, fmt.Errorf("base64 decode: %w", err)
		}
	}

	var p Payload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("json unmarshal: %w", err)
	}
	if p.NodeCertPem == "" || p.NodeKeyPem == "" || p.CACertPem == "" {
		return nil, errors.New("payload missing required fields")
	}
	return &p, nil
}

// Encode is the inverse of Decode. Useful for tests and tooling.
func Encode(p *Payload) (string, error) {
	raw, err := json.Marshal(p)
	if err != nil {
		return "", fmt.Errorf("json marshal: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
