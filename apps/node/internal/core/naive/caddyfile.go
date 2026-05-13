// Package naive implements CoreAdapter for NaiveProxy. Multi-user mode
// requires Caddy compiled with the klzgrad/forwardproxy@naive fork — the
// upstream standalone naive binary is single-tenant only.
//
// Slice 20 ships the Caddyfile generator + caddy-reload pipeline. Per-user
// stats are not implemented (upstream forwardproxy doesn't expose them);
// `GetStats` returns the tracked user list with zero counters.
package naive

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// InboundConfig is the static part of the Caddyfile — generated once from
// admin settings (slice 23 will move it into the inbounds table) and kept
// constant across user mutations.
type InboundConfig struct {
	// Hostname is the public domain Caddy answers on, e.g. "n1.example.com".
	// Required — Caddy needs it for the automatic ACME flow.
	Hostname string

	// ListenPort is the TCP port Caddy binds to. Default 443.
	ListenPort int

	// TLSEmail is the contact address ACME uses for cert-renewal notices.
	// Required — Let's Encrypt rejects empty contacts.
	TLSEmail string

	// MasqueradeRoot is the local directory Caddy serves to anyone hitting
	// the host without valid basic-auth (probe-resistance fronting). The
	// directory must exist on the node; bootstrap script can drop a static
	// HTML page there. Default "/var/www/html".
	MasqueradeRoot string
}

// User is the per-user pair Caddy needs in the forward_proxy block.
type User struct {
	// Username is what the client sends in the HTTP Basic auth header.
	// Naive's URI uses it as the userinfo part: naive+https://user:pass@host.
	Username string

	// Password is the user's `naive_password` from the panel users table.
	Password string
}

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.ListenPort == 0 {
		out.ListenPort = 443
	}
	if out.MasqueradeRoot == "" {
		out.MasqueradeRoot = "/var/www/html"
	}
	return out
}

func (c *InboundConfig) validate() error {
	if c.Hostname == "" {
		return errors.New("Hostname is required (Caddy needs it for ACME)")
	}
	if c.TLSEmail == "" {
		return errors.New("TLSEmail is required (ACME rejects empty contact)")
	}
	if strings.ContainsAny(c.Hostname, " {}\n\r\t") {
		return fmt.Errorf("Hostname contains forbidden char: %q", c.Hostname)
	}
	return nil
}

func (u *User) validate() error {
	if u.Username == "" || u.Password == "" {
		return fmt.Errorf("user has empty Username or Password: %+v", *u)
	}
	if strings.ContainsAny(u.Username, " \t\n\r{}") || strings.ContainsAny(u.Password, " \t\n\r{}") {
		return fmt.Errorf("Caddyfile-unsafe character in user %q", u.Username)
	}
	return nil
}

// renderCaddyfile produces a complete Caddyfile blob for the inbound + the
// given users. Output is plain text (the format Caddy parses natively); the
// adapter writes it to disk and runs `caddy reload`.
//
// Users are emitted in deterministic Username-sorted order so successive
// renders produce byte-identical files (helps `caddy reload` skip no-op
// reloads and makes diffs in `git status`-style audits stable).
func renderCaddyfile(inbound InboundConfig, users []User) (string, error) {
	if err := inbound.validate(); err != nil {
		return "", err
	}
	for i := range users {
		if err := users[i].validate(); err != nil {
			return "", err
		}
	}
	cfg := inbound.withDefaults()

	sorted := append([]User(nil), users...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Username < sorted[j].Username })

	var b strings.Builder
	fmt.Fprintf(&b, ":%d, %s {\n", cfg.ListenPort, cfg.Hostname)
	fmt.Fprintf(&b, "\ttls %s\n", cfg.TLSEmail)
	fmt.Fprintln(&b, "\troute {")
	// forward_proxy with probe_resistance + zero basic_auth lines fails
	// validation: "probe resistance requires authentication". Emit the
	// block only when we have at least one user. Before any user is
	// added the site is pure file_server masquerade — looks like a
	// vanilla static-content host on probes, which is what we want.
	if len(sorted) > 0 {
		fmt.Fprintln(&b, "\t\tforward_proxy {")
		for _, u := range sorted {
			fmt.Fprintf(&b, "\t\t\tbasic_auth %s %s\n", u.Username, u.Password)
		}
		fmt.Fprintln(&b, "\t\t\thide_ip")
		fmt.Fprintln(&b, "\t\t\thide_via")
		fmt.Fprintln(&b, "\t\t\tprobe_resistance")
		fmt.Fprintln(&b, "\t\t}")
	}
	fmt.Fprintf(&b, "\t\tfile_server {\n\t\t\troot %s\n\t\t}\n", cfg.MasqueradeRoot)
	fmt.Fprintln(&b, "\t}")
	fmt.Fprintln(&b, "}")
	return b.String(), nil
}

// writeCaddyfile atomically writes the rendered Caddyfile to disk. mode 0o600
// — the file contains every user's plaintext NaiveProxy password.
func writeCaddyfile(path string, blob string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(blob), 0o600); err != nil {
		return fmt.Errorf("write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename %s -> %s: %w", tmp, path, err)
	}
	return nil
}
