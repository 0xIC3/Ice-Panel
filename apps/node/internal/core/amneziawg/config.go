// Package amneziawg implements CoreAdapter for AmneziaWG (DPI-resistant
// WireGuard fork). Slice 19 ships config generation and `awg syncconf`-based
// hot-reload — no kernel-module install or peer management yet (those land in
// the adapter and bootstrap commits).
//
// Obfuscation parameters split into two groups:
//   - Interface-immutable: S1-S4, H1-H4. Changing them requires bouncing every
//     client. Treated as set-once per inbound lifetime.
//   - Currently interface-fixed but client-tunable in upstream: Jc/Jmin/Jmax.
//     Phase 2 keeps them interface-wide for simplicity (matches bivlked's
//     installer); Phase 3 may diverge per-client if there's demand.
//
// Recommended defaults aim at Russian TSPU; admins override per-inbound in
// slice 23's editor (TSPU / Mobile / Custom presets).
package amneziawg

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// allowedHookPrefixes is the strict whitelist of commands acceptable in
// PostUp/PostDown. awg-quick treats those fields as a shell command, so
// anything outside this list — pipes, redirects, &&, $(...), backticks,
// arbitrary binaries — is rejected with an error before render.
var allowedHookPrefixes = []string{
	"iptables ",
	"ip6tables ",
	"ip ",          // `ip route add ...` etc.
	"sysctl ",
	"echo ",        // common in install-time NAT setup snippets
}

// validatePostHook returns an error unless `cmd` either is empty or starts
// with one of `allowedHookPrefixes` AND contains no shell metacharacters.
// Empty string is fine — render emits an unused PostUp/PostDown line in
// that case, awg-quick treats it as a no-op.
func validatePostHook(cmd string) error {
	if cmd == "" {
		return nil
	}
	for _, ch := range []string{";", "&", "|", "$", "`", "\n", ">", "<"} {
		if strings.Contains(cmd, ch) {
			return fmt.Errorf("disallowed shell metacharacter %q in hook", ch)
		}
	}
	for _, p := range allowedHookPrefixes {
		if strings.HasPrefix(cmd, p) {
			return nil
		}
	}
	return fmt.Errorf("hook command must start with one of: %s", strings.Join(allowedHookPrefixes, ", "))
}

// InboundConfig is the static part of the AmneziaWG interface — generated once
// from admin settings (slice 23 will move these into the inbounds table) and
// kept constant across user mutations. Peer set is passed separately to
// renderConfig because it changes per AddUser/RemoveUser.
type InboundConfig struct {
	// Interface is the name of the awg device, e.g. "awg0". Must match what
	// `awg syncconf <iface>` will receive.
	Interface string

	// ListenPort is the public UDP port advertised to clients. Default 51820.
	ListenPort int

	// PrivateKey is the server's WireGuard private key (base64, 32 bytes raw).
	PrivateKey string

	// Address is the server's IP inside the tunnel, in CIDR form
	// (e.g. "10.0.0.1/24"). Must match the subnet the IP allocator
	// (panel-backend amneziawg.service) is handing out from.
	Address string

	// Junk parameters — currently interface-fixed in MVP.
	Jc   int // junk packet count
	Jmin int // junk packet size min
	Jmax int // junk packet size max

	// Magic header sizes — interface-immutable. Bouncing rotates all clients.
	S1, S2, S3, S4 int

	// Magic header values — interface-immutable, must be 32-bit and pairwise
	// distinct from one another and from WireGuard's defaults (1..4).
	H1, H2, H3, H4 uint32

	// Optional NAT setup. If empty, defaults to the standard MASQUERADE rule
	// over the host's primary egress interface. Operators on tightly-firewalled
	// hosts may want to set these explicitly.
	PostUp   string
	PostDown string
}

// Peer is a single [Peer] block. Generated from a panel `amneziawg_peers` row.
type Peer struct {
	PublicKey string
	// AllowedIP is the peer's IP in CIDR /32 form, e.g. "10.0.0.2/32".
	AllowedIP string
}

func (c *InboundConfig) withDefaults() InboundConfig {
	out := *c
	if out.Interface == "" {
		out.Interface = "awg0"
	}
	if out.ListenPort == 0 {
		out.ListenPort = 51820
	}
	if out.Address == "" {
		out.Address = "10.0.0.1/24"
	}
	if out.Jc == 0 {
		out.Jc = 4
	}
	if out.Jmin == 0 {
		out.Jmin = 40
	}
	if out.Jmax == 0 {
		out.Jmax = 70
	}
	if out.S1 == 0 {
		out.S1 = 72
	}
	if out.S2 == 0 {
		out.S2 = 56
	}
	if out.S3 == 0 {
		out.S3 = 32
	}
	if out.S4 == 0 {
		out.S4 = 16
	}
	if out.PostUp == "" {
		out.PostUp = "iptables -t nat -A POSTROUTING -o %i -j MASQUERADE"
	}
	if out.PostDown == "" {
		out.PostDown = "iptables -t nat -D POSTROUTING -o %i -j MASQUERADE"
	}
	return out
}

func (c *InboundConfig) validate() error {
	if c.PrivateKey == "" {
		return errors.New("PrivateKey is required")
	}
	for _, h := range []struct {
		name string
		val  uint32
	}{{"H1", c.H1}, {"H2", c.H2}, {"H3", c.H3}, {"H4", c.H4}} {
		if h.val == 0 {
			return fmt.Errorf("%s is required (must be a 32-bit value, non-zero, distinct from 1..4)", h.name)
		}
		if h.val <= 4 {
			return fmt.Errorf("%s=%d collides with WireGuard's default header values (1..4)", h.name, h.val)
		}
	}
	uniq := map[uint32]string{
		c.H1: "H1", c.H2: "H2", c.H3: "H3", c.H4: "H4",
	}
	if len(uniq) != 4 {
		return errors.New("H1-H4 must be pairwise distinct")
	}
	if c.Jmin > c.Jmax {
		return fmt.Errorf("Jmin (%d) must be <= Jmax (%d)", c.Jmin, c.Jmax)
	}
	return nil
}

// renderConfig produces a complete awg-quick config string for the given peers.
// Output is plain text (not JSON) because that's what `awg syncconf` and
// `awg-quick` consume. Peers are written in the order received — caller is
// expected to sort by IP if it wants stable diffs.
func renderConfig(inbound InboundConfig, peers []Peer) (string, error) {
	if err := inbound.validate(); err != nil {
		return "", err
	}
	cfg := inbound.withDefaults()

	var b strings.Builder
	fmt.Fprintln(&b, "[Interface]")
	fmt.Fprintf(&b, "PrivateKey = %s\n", cfg.PrivateKey)
	fmt.Fprintf(&b, "ListenPort = %d\n", cfg.ListenPort)
	fmt.Fprintf(&b, "Address = %s\n", cfg.Address)
	fmt.Fprintf(&b, "Jc = %d\n", cfg.Jc)
	fmt.Fprintf(&b, "Jmin = %d\n", cfg.Jmin)
	fmt.Fprintf(&b, "Jmax = %d\n", cfg.Jmax)
	fmt.Fprintf(&b, "S1 = %d\n", cfg.S1)
	fmt.Fprintf(&b, "S2 = %d\n", cfg.S2)
	fmt.Fprintf(&b, "S3 = %d\n", cfg.S3)
	fmt.Fprintf(&b, "S4 = %d\n", cfg.S4)
	fmt.Fprintf(&b, "H1 = %d\n", cfg.H1)
	fmt.Fprintf(&b, "H2 = %d\n", cfg.H2)
	fmt.Fprintf(&b, "H3 = %d\n", cfg.H3)
	fmt.Fprintf(&b, "H4 = %d\n", cfg.H4)
	// awg-quick evaluates PostUp/PostDown as a shell command, so anything
	// we render here runs as root on every interface bounce. PostUp/Down
	// are NOT accepted on the panel→node wire (see adapter.go ApplyInbound)
	// — they only reach this point from install-time env on the VPS, which
	// is admin-controlled. We still hard-whitelist allowed command prefixes
	// here as defence-in-depth so a future maintainer who plumbs them
	// through the wire by accident can't accidentally introduce RCE.
	if err := validatePostHook(cfg.PostUp); err != nil {
		return "", fmt.Errorf("PostUp: %w", err)
	}
	if err := validatePostHook(cfg.PostDown); err != nil {
		return "", fmt.Errorf("PostDown: %w", err)
	}
	fmt.Fprintf(&b, "PostUp = %s\n", cfg.PostUp)
	fmt.Fprintf(&b, "PostDown = %s\n", cfg.PostDown)

	for _, p := range peers {
		if p.PublicKey == "" || p.AllowedIP == "" {
			return "", fmt.Errorf("peer with empty PublicKey or AllowedIP: %+v", p)
		}
		fmt.Fprintln(&b)
		fmt.Fprintln(&b, "[Peer]")
		fmt.Fprintf(&b, "PublicKey = %s\n", p.PublicKey)
		fmt.Fprintf(&b, "AllowedIPs = %s\n", p.AllowedIP)
	}

	return b.String(), nil
}

// writeConfig atomically writes the awg config to disk. mode 0o600 — file
// contains the server's private key.
func writeConfig(path string, blob string) error {
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
