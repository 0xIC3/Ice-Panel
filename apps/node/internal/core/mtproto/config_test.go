package mtproto

import (
	"strings"
	"testing"
)

func TestDeriveSecret_DeterministicAndShape(t *testing.T) {
	uuid := "cabc78ae-94e3-4a16-936a-133d059acfac"
	domain := "www.cloudflare.com"

	a := DeriveSecret(uuid, domain)
	b := DeriveSecret(uuid, domain)
	if a != b {
		t.Errorf("DeriveSecret should be deterministic: %q vs %q", a, b)
	}
	if !strings.HasPrefix(a, "ee") {
		t.Errorf("Secret must start with `ee` (Fake-TLS marker): %q", a)
	}
	// `ee` (2) + sha256 hex (64) + domain hex (len(domain)*2)
	expectedLen := 2 + 64 + len(domain)*2
	if len(a) != expectedLen {
		t.Errorf("Secret length: got %d want %d", len(a), expectedLen)
	}
}

func TestDeriveSecret_DomainChangeRotates(t *testing.T) {
	uuid := "cabc78ae-94e3-4a16-936a-133d059acfac"
	a := DeriveSecret(uuid, "www.cloudflare.com")
	b := DeriveSecret(uuid, "www.google.com")
	if a == b {
		t.Errorf("Domain change MUST rotate the secret (32-byte prefix preserved but suffix differs)")
	}
}

func TestInboundValidation(t *testing.T) {
	cases := []struct {
		name    string
		mut     func(*InboundConfig)
		wantErr string
	}{
		{"missing domain", func(c *InboundConfig) { c.Domain = "" }, "Domain is required"},
		{"slash in domain", func(c *InboundConfig) { c.Domain = "evil/path" }, "forbidden"},
		{"colon in domain", func(c *InboundConfig) { c.Domain = "h:p" }, "forbidden"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := InboundConfig{Domain: "www.cloudflare.com"}
			tc.mut(&cfg)
			if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validate: got %v want error containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestInboundDefaults(t *testing.T) {
	cfg := (&InboundConfig{}).withDefaults()
	if cfg.Domain != "www.cloudflare.com" {
		t.Errorf("Domain default: got %q", cfg.Domain)
	}
	if cfg.ListenPort != 443 {
		t.Errorf("ListenPort default: got %d", cfg.ListenPort)
	}
	if cfg.StatsPort != 3129 {
		t.Errorf("StatsPort default: got %d", cfg.StatsPort)
	}
}

func TestRenderConfig_TomlShape(t *testing.T) {
	cfg := InboundConfig{Domain: "www.cloudflare.com", ListenPort: 443, StatsPort: 3129}
	secret1 := DeriveSecret("uuid-a", cfg.Domain)
	secret2 := DeriveSecret("uuid-b", cfg.Domain)
	blob, err := renderConfig(cfg, []string{secret1, secret2})
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	out := string(blob)

	for _, want := range []string{
		`bind-to = "0.0.0.0:443"`,
		`stats-bind-to = "127.0.0.1:3129"`,
		`network-timeout = "10s"`,
		`secrets = [`,
		secret1,
		secret2,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing fragment %q in render:\n%s", want, out)
		}
	}
}

func TestRenderConfig_EmptySecrets(t *testing.T) {
	cfg := InboundConfig{Domain: "www.cloudflare.com"}
	blob, err := renderConfig(cfg, nil)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	if !strings.Contains(string(blob), `secrets = []`) {
		t.Errorf("empty secrets should render as `secrets = []`:\n%s", blob)
	}
}

func TestSortedSecrets_Deterministic(t *testing.T) {
	users := map[string]string{
		"u-c": "ee03",
		"u-a": "ee01",
		"u-b": "ee02",
	}
	got := sortedSecrets(users)
	want := []string{"ee01", "ee02", "ee03"}
	for i, v := range want {
		if got[i] != v {
			t.Errorf("position %d: got %q want %q", i, got[i], v)
		}
	}
}
