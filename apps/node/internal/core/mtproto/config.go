// Package mtproto implements CoreAdapter for the Telegram MTProto proxy
// via 9seconds/mtg. Slice 41.
//
// Architecture:
//   - mtg is a relay — Telegram's MTProto encryption is preserved end-to-end.
//   - Multi-user via secrets list in TOML config; SIGHUP reloads.
//   - Per-user secret deterministically derived from (xrayUuid, domain) so
//     panel and agent compute the same secret without explicit synchronisation.
//   - Fake-TLS mode mandatory — current TG clients reject anything else.
package mtproto

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// InboundConfig holds per-instance settings.
type InboundConfig struct {
	// Domain is the masquerade target for Fake-TLS handshake. Hex-encoded
	// into every per-user secret. Changing it rotates ALL secrets.
	Domain string

	// ListenPort is the public TCP port mtg binds to. Default 443 — TG
	// clients try this port first heuristically.
	ListenPort int

	// StatsPort is the loopback Prometheus endpoint port. Default 3129.
	StatsPort int
}

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.Domain == "" {
		out.Domain = "www.cloudflare.com"
	}
	if out.ListenPort == 0 {
		out.ListenPort = 443
	}
	if out.StatsPort == 0 {
		out.StatsPort = 3129
	}
	return out
}

func (c *InboundConfig) validate() error {
	if c.Domain == "" {
		return errors.New("Domain is required")
	}
	for _, ch := range c.Domain {
		if ch == ' ' || ch == '\n' || ch == '/' || ch == ':' {
			return fmt.Errorf("Domain contains forbidden char: %q", c.Domain)
		}
	}
	return nil
}

// DeriveSecret matches the panel-side `mtprotoSecret(uuid, domain)` exactly
// — both compute `ee<sha256(uuid)[:32].hex><domain.hex>`. That determinism
// is the contract that lets us update the agent's secrets list without the
// panel having to push them explicitly.
func DeriveSecret(uuid, domain string) string {
	h := sha256.Sum256([]byte(uuid))
	return "ee" + hex.EncodeToString(h[:]) + hex.EncodeToString([]byte(domain))
}

// renderConfig produces the mtg TOML config. Format reference:
// https://github.com/9seconds/mtg/blob/master/example.config.toml
//
// We hand-write TOML rather than pulling in `pelletier/go-toml` because the
// surface is tiny (5 keys + secrets list) and string generation gives us
// deterministic output for golden-test friendly diffing.
func renderConfig(inbound InboundConfig, secrets []string) ([]byte, error) {
	if err := inbound.validate(); err != nil {
		return nil, err
	}
	cfg := inbound.withDefaults()

	var b strings.Builder
	fmt.Fprintf(&b, "secret = \"\"\n") // legacy single-secret mode disabled
	fmt.Fprintf(&b, "bind-to = \"0.0.0.0:%d\"\n", cfg.ListenPort)
	fmt.Fprintf(&b, "stats-bind-to = \"127.0.0.1:%d\"\n", cfg.StatsPort)
	fmt.Fprintf(&b, "network-timeout = \"10s\"\n")
	fmt.Fprintf(&b, "buffer-size = \"16Kb\"\n")
	fmt.Fprintf(&b, "prefer-ip = \"ipv4\"\n")
	b.WriteString("\n")

	if len(secrets) > 0 {
		b.WriteString("secrets = [\n")
		for _, s := range secrets {
			fmt.Fprintf(&b, "  \"%s\",\n", s)
		}
		b.WriteString("]\n")
	} else {
		b.WriteString("secrets = []\n")
	}

	return []byte(b.String()), nil
}

// writeConfig atomically writes the TOML to disk. Mode 0o600 — file
// contains every user's MTProto secret.
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

// sortedSecrets returns secrets in deterministic order so renderConfig is
// byte-stable across user-map iterations.
func sortedSecrets(in map[string]string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}
