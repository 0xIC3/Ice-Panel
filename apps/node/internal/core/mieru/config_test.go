package mieru

import (
	"strings"
	"testing"
)

func TestInboundDefaults(t *testing.T) {
	cfg := (&InboundConfig{}).withDefaults()
	if cfg.ListenPort != 2012 {
		t.Errorf("ListenPort default: got %d", cfg.ListenPort)
	}
	if cfg.MTU != 1400 {
		t.Errorf("MTU default: got %d", cfg.MTU)
	}
	if cfg.LoggingLevel != "INFO" {
		t.Errorf("LoggingLevel default: got %q", cfg.LoggingLevel)
	}
}

func TestInboundValidation(t *testing.T) {
	cases := []struct {
		name    string
		mut     func(*InboundConfig)
		wantErr string
	}{
		{"MTU too low", func(c *InboundConfig) { c.MTU = 100 }, "out of range"},
		{"MTU too high", func(c *InboundConfig) { c.MTU = 9000 }, "out of range"},
		{"unknown log level", func(c *InboundConfig) { c.LoggingLevel = "TRACE" }, "not in DEBUG"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := InboundConfig{}
			tc.mut(&cfg)
			if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("validate: got %v want error containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestRenderConfig_PortBindingsTcpAndUdp(t *testing.T) {
	cfg := InboundConfig{ListenPort: 2012}
	blob, err := renderConfig(cfg, nil)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	out := string(blob)

	for _, want := range []string{
		"portBindings:",
		"  - port: 2012",
		"    protocol: TCP",
		"    protocol: UDP",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing fragment %q in render:\n%s", want, out)
		}
	}
}

func TestRenderConfig_UsersList(t *testing.T) {
	cfg := InboundConfig{ListenPort: 2012}
	users := []User{
		{Name: "alice", Password: "pw-a"},
		{Name: "bob", Password: "pw-b"},
	}
	blob, err := renderConfig(cfg, users)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	out := string(blob)

	for _, want := range []string{
		"users:",
		"  - name: alice",
		"    password: pw-a",
		"  - name: bob",
		"    password: pw-b",
		"mtu: 1400",
		"loggingLevel: INFO",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing fragment %q in render:\n%s", want, out)
		}
	}
}

func TestRenderConfig_EmptyUsersList(t *testing.T) {
	blob, err := renderConfig(InboundConfig{}, nil)
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	if !strings.Contains(string(blob), "users: []") {
		t.Errorf("empty users should render as `users: []`:\n%s", blob)
	}
}

func TestRenderConfig_RejectsEmptyUserName(t *testing.T) {
	_, err := renderConfig(InboundConfig{}, []User{{Name: "", Password: "x"}})
	if err == nil || !strings.Contains(err.Error(), "empty user name") {
		t.Errorf("expected empty-name error, got %v", err)
	}
}

func TestRenderConfig_RejectsEmptyUserPassword(t *testing.T) {
	_, err := renderConfig(InboundConfig{}, []User{{Name: "alice", Password: ""}})
	if err == nil || !strings.Contains(err.Error(), "empty user password") {
		t.Errorf("expected empty-password error, got %v", err)
	}
}

func TestSortedUsers_Deterministic(t *testing.T) {
	users := map[string]User{
		"u-c": {Name: "carol", Password: "x"},
		"u-a": {Name: "alice", Password: "x"},
		"u-b": {Name: "bob", Password: "x"},
	}
	got := sortedUsers(users)
	want := []string{"alice", "bob", "carol"}
	for i, name := range want {
		if got[i].Name != name {
			t.Errorf("position %d: got %q want %q", i, got[i].Name, name)
		}
	}
}
