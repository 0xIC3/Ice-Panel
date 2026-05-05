package naive

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validInbound() InboundConfig {
	return InboundConfig{
		Hostname: "n1.example.com",
		TLSEmail: "ops@example.com",
	}
}

func TestInboundDefaults(t *testing.T) {
	in := validInbound()
	cfg := in.withDefaults()
	if cfg.ListenPort != 443 {
		t.Errorf("ListenPort default: got %d", cfg.ListenPort)
	}
	if cfg.MasqueradeRoot != "/var/www/html" {
		t.Errorf("MasqueradeRoot default: got %q", cfg.MasqueradeRoot)
	}
}

func TestInboundValidation(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*InboundConfig)
		wantErr string
	}{
		{"missing hostname", func(c *InboundConfig) { c.Hostname = "" }, "Hostname"},
		{"missing TLS email", func(c *InboundConfig) { c.TLSEmail = "" }, "TLSEmail"},
		{"hostname with brace", func(c *InboundConfig) { c.Hostname = "evil{.com" }, "forbidden"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validInbound()
			tc.mutate(&cfg)
			err := cfg.validate()
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validate: got %v, want error containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestUserValidation(t *testing.T) {
	cases := []struct {
		name string
		u    User
	}{
		{"empty username", User{Username: "", Password: "p"}},
		{"empty password", User{Username: "u", Password: ""}},
		{"username with space", User{Username: "u ser", Password: "p"}},
		{"password with brace", User{Username: "u", Password: "p}q"}},
		{"password with newline", User{Username: "u", Password: "p\nq"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u := tc.u
			if err := u.validate(); err == nil {
				t.Errorf("expected validation error for %+v", u)
			}
		})
	}
}

func TestRenderCaddyfileShape(t *testing.T) {
	users := []User{
		{Username: "alice", Password: "secret-a"},
		{Username: "bob", Password: "secret-b"},
	}
	out, err := renderCaddyfile(validInbound(), users)
	if err != nil {
		t.Fatalf("renderCaddyfile: %v", err)
	}
	for _, want := range []string{
		":443, n1.example.com {",
		"tls ops@example.com",
		"forward_proxy {",
		"basic_auth alice secret-a",
		"basic_auth bob secret-b",
		"hide_ip",
		"hide_via",
		"probe_resistance",
		"file_server {",
		"root /var/www/html",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("rendered Caddyfile missing %q. Output:\n%s", want, out)
		}
	}
}

func TestRenderCaddyfileSortsUsers(t *testing.T) {
	// Same users in different order should produce byte-identical output —
	// otherwise `caddy reload` flaps even on no-op user-set changes.
	users1 := []User{{Username: "bob", Password: "b"}, {Username: "alice", Password: "a"}}
	users2 := []User{{Username: "alice", Password: "a"}, {Username: "bob", Password: "b"}}
	out1, _ := renderCaddyfile(validInbound(), users1)
	out2, _ := renderCaddyfile(validInbound(), users2)
	if out1 != out2 {
		t.Errorf("expected deterministic order; got:\n--- a:\n%s\n--- b:\n%s", out1, out2)
	}
}

func TestRenderCaddyfileNoUsers(t *testing.T) {
	out, err := renderCaddyfile(validInbound(), nil)
	if err != nil {
		t.Fatalf("renderCaddyfile: %v", err)
	}
	if strings.Contains(out, "basic_auth") {
		t.Errorf("expected no basic_auth lines when user list empty:\n%s", out)
	}
	// forward_proxy block + file_server still expected.
	if !strings.Contains(out, "forward_proxy {") || !strings.Contains(out, "probe_resistance") {
		t.Errorf("forward_proxy block missing for empty user list:\n%s", out)
	}
}

func TestRenderCaddyfilePropagatesUserError(t *testing.T) {
	bad := []User{{Username: "ok", Password: "ok"}, {Username: "x x", Password: "p"}}
	if _, err := renderCaddyfile(validInbound(), bad); err == nil {
		t.Errorf("expected user-validation error to propagate")
	}
}

func TestRenderCaddyfilePropagatesInboundError(t *testing.T) {
	bad := validInbound()
	bad.TLSEmail = ""
	if _, err := renderCaddyfile(bad, nil); err == nil {
		t.Errorf("expected inbound-validation error to propagate")
	}
}

func TestWriteCaddyfileAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "etc", "caddy", "Caddyfile")
	blob := ":443, n.example.com {\n\ttls e@example.com\n}\n"
	if err := writeCaddyfile(path, blob); err != nil {
		t.Fatalf("writeCaddyfile: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != blob {
		t.Errorf("content mismatch: got %q want %q", string(got), blob)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("expected 0600 perms (file holds plaintext passwords), got %o", mode)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("temp file lingered: %v", err)
	}
}
