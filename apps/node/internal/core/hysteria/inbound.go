package hysteria

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

// InboundConfig holds the panel-pushed runtime config that lands in
// /etc/hysteria/config.yaml. Install-time settings (listen port, ACME
// domain/email, auth callback URL) live on adapter.Config — those don't
// flow over the wire because they're identity for the node, not per-inbound.
type InboundConfig struct {
	ObfsPassword   string
	MasqueradeURL  string
	BrutalUpMbps   int
	BrutalDownMbps int
}

// inboundCfgWire mirrors HysteriaConfigSchema in
// apps/panel-backend/src/modules/inbounds/inbounds.schemas.ts. Field names
// are JSON-camelCase to match what the panel emits over /applyInbounds.
type inboundCfgWire struct {
	ObfsPassword   string `json:"obfsPassword,omitempty"`
	MasqueradeURL  string `json:"masqueradeUrl,omitempty"`
	BrutalUpMbps   int    `json:"brutalUpMbps,omitempty"`
	BrutalDownMbps int    `json:"brutalDownMbps,omitempty"`
}

func (w inboundCfgWire) toInboundConfig() InboundConfig {
	return InboundConfig{
		ObfsPassword:   w.ObfsPassword,
		MasqueradeURL:  w.MasqueradeURL,
		BrutalUpMbps:   w.BrutalUpMbps,
		BrutalDownMbps: w.BrutalDownMbps,
	}
}

func inboundEqual(a, b InboundConfig) bool {
	return a.ObfsPassword == b.ObfsPassword &&
		a.MasqueradeURL == b.MasqueradeURL &&
		a.BrutalUpMbps == b.BrutalUpMbps &&
		a.BrutalDownMbps == b.BrutalDownMbps
}

// renderConfig produces a deterministic YAML body for hysteria server. The
// shape matches what we manually wrote during the 2026-05-07 VPS test —
// listen + acme + auth + (obfs?) + (masquerade?) + (bandwidth?). No keys are
// emitted in random order, no time-stamps, so byte-identical inputs produce
// byte-identical output (golden-test friendly).
//
// We hand-roll YAML rather than pulling in gopkg.in/yaml.v3 because the
// surface is tiny and the layout is fixed; a 60-line writer is cheaper than
// a transitive dep.
func renderConfig(adapterCfg Config, inbound InboundConfig) ([]byte, error) {
	if adapterCfg.Hostname == "" {
		return nil, fmt.Errorf("hysteria render: Hostname is required")
	}
	if adapterCfg.ACMEEmail == "" {
		return nil, fmt.Errorf("hysteria render: ACMEEmail is required")
	}
	listenPort := adapterCfg.ListenPort
	if listenPort == 0 {
		listenPort = 443
	}
	authHost := adapterCfg.AuthCallbackHost
	if authHost == "" {
		authHost = "127.0.0.1"
	}
	authPort := adapterCfg.AuthCallbackPort
	if authPort == 0 {
		authPort = 9000
	}

	var b bytes.Buffer
	fmt.Fprintf(&b, "listen: :%d\n", listenPort)
	b.WriteString("\n")
	b.WriteString("acme:\n")
	b.WriteString("  domains:\n")
	fmt.Fprintf(&b, "    - %s\n", adapterCfg.Hostname)
	fmt.Fprintf(&b, "  email: %s\n", adapterCfg.ACMEEmail)
	b.WriteString("\n")
	b.WriteString("auth:\n")
	b.WriteString("  type: http\n")
	b.WriteString("  http:\n")
	fmt.Fprintf(&b, "    url: http://%s:%d/auth\n", authHost, authPort)

	if inbound.ObfsPassword != "" {
		b.WriteString("\n")
		b.WriteString("obfs:\n")
		b.WriteString("  type: salamander\n")
		b.WriteString("  salamander:\n")
		fmt.Fprintf(&b, "    password: %s\n", inbound.ObfsPassword)
	}

	if inbound.MasqueradeURL != "" {
		b.WriteString("\n")
		b.WriteString("masquerade:\n")
		b.WriteString("  type: proxy\n")
		b.WriteString("  proxy:\n")
		fmt.Fprintf(&b, "    url: %s\n", inbound.MasqueradeURL)
		b.WriteString("    rewriteHost: true\n")
	}

	if inbound.BrutalUpMbps > 0 || inbound.BrutalDownMbps > 0 {
		b.WriteString("\n")
		b.WriteString("bandwidth:\n")
		if inbound.BrutalUpMbps > 0 {
			fmt.Fprintf(&b, "  up: %d mbps\n", inbound.BrutalUpMbps)
		}
		if inbound.BrutalDownMbps > 0 {
			fmt.Fprintf(&b, "  down: %d mbps\n", inbound.BrutalDownMbps)
		}
	}

	// Cycle #5 ground truth: Hysteria 2 + Brutal CC requires the client to
	// declare its own bandwidth at session start. Hiddify iOS / NekoBox /
	// Streisand frequently negotiate `up=0` and the tunnel handshake then
	// completes successfully but every proxied request times out at tx=0.
	// Setting `ignoreClientBandwidth: true` forces BBR (CUBIC-class
	// congestion control) and removes the client-bandwidth dependency
	// entirely — at the cost of not using Brutal's aggressive scheduling.
	// For real-world residential broadband this is invisible; for clients
	// that DO declare valid bandwidth values via our subscription URI
	// (`upmbps=`/`downmbps=`) Brutal still kicks in. Net: defaults that
	// "just work" without sacrificing power-user tunability.
	b.WriteString("\nignoreClientBandwidth: true\n")

	return b.Bytes(), nil
}

// writeConfig atomically writes the rendered YAML. tmp + rename so a hysteria
// reload racing the writer never sees a half-formed file.
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
