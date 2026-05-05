// Package xray implements CoreAdapter for Xray-core. Slice 17 ships VLESS +
// REALITY support via the config-restart pattern: every AddUser / RemoveUser
// regenerates `config.json` and restarts the xray subprocess. Brief downtime
// per mutation (~1s) is acceptable for the initial multi-core release.
//
// A future Phase 3 slice may switch to gRPC `proxyman.HandlerService.AlterInbound`
// for live user management with no restart, once we vendor the proto types.
package xray

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// InboundConfig is the static part of the Xray config — generated once from
// admin settings (slice 23 will move these into the inbounds table) and kept
// constant across user mutations.
type InboundConfig struct {
	// Tag uniquely identifies the inbound inside Xray. Default: "vless-in".
	Tag string

	// ListenHost is the bind address. Default: "0.0.0.0".
	ListenHost string

	// ListenPort is the public TCP port for VLESS+REALITY. Default: 443.
	ListenPort int

	// REALITY settings — interface-level, not per-user. Slice 23 moves
	// these into the inbounds table and lets the admin edit them.
	RealityDest        string   // e.g. "www.cloudflare.com:443"
	RealityServerNames []string // e.g. ["www.cloudflare.com"]
	RealityPrivateKey  string   // x25519 private key (paired pubkey advertised in URI)
	RealityShortIDs    []string // hex strings, max 16 chars each

	// Flow controls Vision (xtls-rprx-vision) on the client side; empty disables.
	Flow string
}

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.Tag == "" {
		out.Tag = "vless-in"
	}
	if out.ListenHost == "" {
		out.ListenHost = "0.0.0.0"
	}
	if out.ListenPort == 0 {
		out.ListenPort = 443
	}
	if out.Flow == "" {
		out.Flow = "xtls-rprx-vision"
	}
	return out
}

func (c *InboundConfig) validate() error {
	if c.RealityPrivateKey == "" {
		return errors.New("RealityPrivateKey is required")
	}
	if len(c.RealityServerNames) == 0 {
		return errors.New("RealityServerNames must have at least one entry")
	}
	if len(c.RealityShortIDs) == 0 {
		return errors.New("RealityShortIDs must have at least one entry")
	}
	if c.RealityDest == "" {
		return errors.New("RealityDest is required")
	}
	return nil
}

// xrayClient mirrors Xray's client-config object.
type xrayClient struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Flow  string `json:"flow,omitempty"`
}

// renderConfig produces a complete Xray config.json blob for the given users.
// Marshaled as indented JSON for human-readability when an operator needs to
// inspect what the adapter wrote.
func renderConfig(inbound InboundConfig, users []xrayClient) ([]byte, error) {
	if err := inbound.validate(); err != nil {
		return nil, err
	}
	cfg := inbound.withDefaults()
	doc := map[string]any{
		"log": map[string]any{
			"loglevel": "info",
		},
		"inbounds": []map[string]any{
			{
				"tag":      cfg.Tag,
				"listen":   cfg.ListenHost,
				"port":     cfg.ListenPort,
				"protocol": "vless",
				"settings": map[string]any{
					"clients":    users,
					"decryption": "none",
				},
				"streamSettings": map[string]any{
					"network":  "raw",
					"security": "reality",
					"realitySettings": map[string]any{
						"show":        false,
						"dest":        cfg.RealityDest,
						"xver":        0,
						"serverNames": cfg.RealityServerNames,
						"privateKey":  cfg.RealityPrivateKey,
						"shortIds":    cfg.RealityShortIDs,
					},
				},
			},
		},
		"outbounds": []map[string]any{
			{"protocol": "freedom", "tag": "direct"},
		},
	}
	return json.MarshalIndent(doc, "", "  ")
}

// writeConfig atomically writes the config to disk. Uses temp file + rename so
// xray never sees a half-written config if Restart is racing the writer.
func writeConfig(path string, blob []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, blob, 0o600); err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename %s -> %s: %w", tmp, path, err)
	}
	return nil
}
