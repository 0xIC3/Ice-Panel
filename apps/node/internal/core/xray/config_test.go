package xray

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func validInbound() InboundConfig {
	return InboundConfig{
		RealityDest:        "www.cloudflare.com:443",
		RealityServerNames: []string{"www.cloudflare.com"},
		RealityPrivateKey:  "fake-private-key-for-testing",
		RealityShortIDs:    []string{"abc123"},
	}
}

func TestInboundValidation(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(*InboundConfig)
		wantErr string
	}{
		{"missing private key", func(c *InboundConfig) { c.RealityPrivateKey = "" }, "RealityPrivateKey"},
		{"missing server names", func(c *InboundConfig) { c.RealityServerNames = nil }, "RealityServerNames"},
		{"missing short IDs", func(c *InboundConfig) { c.RealityShortIDs = nil }, "RealityShortIDs"},
		{"missing dest", func(c *InboundConfig) { c.RealityDest = "" }, "RealityDest"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validInbound()
			tc.mutate(&cfg)
			if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validate: got %v, want error containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestInboundDefaults(t *testing.T) {
	cfg := InboundConfig{
		RealityDest:        "x.com:443",
		RealityServerNames: []string{"x.com"},
		RealityPrivateKey:  "k",
		RealityShortIDs:    []string{"s"},
	}
	d := cfg.withDefaults()
	if d.Tag != "vless-in" {
		t.Errorf("Tag default: got %q", d.Tag)
	}
	if d.ListenHost != "0.0.0.0" {
		t.Errorf("ListenHost default: got %q", d.ListenHost)
	}
	if d.ListenPort != 443 {
		t.Errorf("ListenPort default: got %d", d.ListenPort)
	}
	if d.Flow != "xtls-rprx-vision" {
		t.Errorf("Flow default: got %q", d.Flow)
	}
}

func TestRenderConfigShape(t *testing.T) {
	users := []xrayClient{
		{ID: "uuid-1", Email: "user-a", Flow: "xtls-rprx-vision"},
		{ID: "uuid-2", Email: "user-b", Flow: "xtls-rprx-vision"},
	}
	blob, err := renderConfig(validInbound(), users)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}

	var parsed map[string]any
	if err := json.Unmarshal(blob, &parsed); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}

	inbounds, ok := parsed["inbounds"].([]any)
	// Slice 24c: render now emits two inbounds — the public VLESS one and a
	// dedicated `api-in` (dokodemo-door on 127.0.0.1:8080) that exposes
	// StatsService for `xray api statsquery`. Find the VLESS inbound by tag.
	if !ok || len(inbounds) != 2 {
		t.Fatalf("expected 2 inbounds (vless + api-in), got %v", parsed["inbounds"])
	}
	var inb map[string]any
	for _, raw := range inbounds {
		m := raw.(map[string]any)
		if m["protocol"] == "vless" {
			inb = m
			break
		}
	}
	if inb == nil {
		t.Fatalf("vless inbound not found in render output")
	}
	stream := inb["streamSettings"].(map[string]any)
	if stream["network"] != "raw" {
		t.Errorf("network: got %v want raw (v24.9.30 naming)", stream["network"])
	}
	if stream["security"] != "reality" {
		t.Errorf("security: got %v want reality", stream["security"])
	}
	settings := inb["settings"].(map[string]any)
	clients := settings["clients"].([]any)
	if len(clients) != 2 {
		t.Errorf("clients: got %d want 2", len(clients))
	}

	// Slice 24c — verify stats wiring is present
	if _, ok := parsed["stats"]; !ok {
		t.Errorf("stats block missing from rendered config")
	}
	api, ok := parsed["api"].(map[string]any)
	if !ok || api["tag"] != "api" {
		t.Errorf("api block missing/wrong: %v", parsed["api"])
	}
	policy := parsed["policy"].(map[string]any)
	levels := policy["levels"].(map[string]any)
	level0 := levels["0"].(map[string]any)
	if level0["statsUserUplink"] != true || level0["statsUserDownlink"] != true {
		t.Errorf("policy.levels.0 missing per-user stats flags: %v", level0)
	}
}

func TestRenderConfigEmptyClients(t *testing.T) {
	blob, err := renderConfig(validInbound(), []xrayClient{})
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	if !strings.Contains(string(blob), `"clients": []`) {
		t.Errorf("expected empty clients array in: %s", string(blob))
	}
}

func TestRenderConfigPropagatesValidationError(t *testing.T) {
	bad := validInbound()
	bad.RealityPrivateKey = ""
	if _, err := renderConfig(bad, nil); err == nil {
		t.Errorf("expected validation error to propagate")
	}
}

func TestWriteConfigAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "subdir", "config.json")
	blob := []byte(`{"hello":"world"}`)
	if err := writeConfig(path, blob); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != string(blob) {
		t.Errorf("content mismatch: got %q", string(got))
	}
	// Temp file should be cleaned up after rename.
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("temp file lingered: %v", err)
	}
}
