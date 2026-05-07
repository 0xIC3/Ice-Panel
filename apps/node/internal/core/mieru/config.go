// Package mieru implements CoreAdapter for the Mieru stealth proxy via
// the `mita` server binary (enfein/mieru). Slice 40.
//
// Architecture:
//   - mita is a single Go binary; we spawn it as a subprocess with a
//     YAML config.
//   - Multi-user via a flat `users:` list in the YAML; reload via
//     `mita apply config <path>` graceful — existing sessions survive.
//   - Per-user creds: name = panel username, password = xrayUuid (no
//     extra credential surface).
package mieru

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// User represents one mita user (name + password).
type User struct {
	Name     string
	Password string
}

// InboundConfig holds per-instance settings.
type InboundConfig struct {
	// ListenPort is the public TCP+UDP port. Default 2012.
	ListenPort int

	// MTU caps the inner-payload size. Default 1400; drop to 1280 on
	// PPPoE / weird VPN paths.
	MTU int

	// LoggingLevel — INFO sane default; DEBUG logs per-connection events
	// (don't enable in prod, very noisy).
	LoggingLevel string
}

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.ListenPort == 0 {
		out.ListenPort = 2012
	}
	if out.MTU == 0 {
		out.MTU = 1400
	}
	if out.LoggingLevel == "" {
		out.LoggingLevel = "INFO"
	}
	return out
}

func (c *InboundConfig) validate() error {
	if c.MTU != 0 && (c.MTU < 576 || c.MTU > 1500) {
		return fmt.Errorf("MTU %d out of range (576-1500)", c.MTU)
	}
	if c.LoggingLevel != "" {
		switch c.LoggingLevel {
		case "DEBUG", "INFO", "WARN", "ERROR":
		default:
			return fmt.Errorf("LoggingLevel %q not in DEBUG/INFO/WARN/ERROR", c.LoggingLevel)
		}
	}
	return nil
}

// renderConfig produces a deterministic mita YAML config.
//
// Reference: docs/references/mieru.md, server-side example.
func renderConfig(inbound InboundConfig, users []User) ([]byte, error) {
	if err := inbound.validate(); err != nil {
		return nil, err
	}
	cfg := inbound.withDefaults()

	var b strings.Builder
	b.WriteString("portBindings:\n")
	fmt.Fprintf(&b, "  - port: %d\n", cfg.ListenPort)
	b.WriteString("    protocol: TCP\n")
	fmt.Fprintf(&b, "  - port: %d\n", cfg.ListenPort)
	b.WriteString("    protocol: UDP\n")
	b.WriteString("\n")

	if len(users) > 0 {
		b.WriteString("users:\n")
		for _, u := range users {
			if u.Name == "" {
				return nil, errors.New("mieru: empty user name")
			}
			if u.Password == "" {
				return nil, errors.New("mieru: empty user password")
			}
			fmt.Fprintf(&b, "  - name: %s\n", u.Name)
			fmt.Fprintf(&b, "    password: %s\n", u.Password)
		}
	} else {
		b.WriteString("users: []\n")
	}
	b.WriteString("\n")

	fmt.Fprintf(&b, "mtu: %d\n", cfg.MTU)
	fmt.Fprintf(&b, "loggingLevel: %s\n", cfg.LoggingLevel)

	return []byte(b.String()), nil
}

// writeConfig atomically writes mita's YAML. Mode 0o600 — file contains
// every user's password.
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

// sortedUsers returns users in deterministic order (by name) so renderConfig
// is byte-stable across map iterations.
func sortedUsers(in map[string]User) []User {
	out := make([]User, 0, len(in))
	for _, u := range in {
		out = append(out, u)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
