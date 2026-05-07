package mtproto

import (
	"encoding/json"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
)

func newConfigOnlyAdapter(t *testing.T) *Adapter {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(Config{
		Inbound: InboundConfig{Domain: "www.cloudflare.com", ListenPort: 443, StatsPort: 3129},
	}, logger)
}

func TestNameMatchesProtocol(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

func TestAddUserDerivesSecret(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	uuid := "cabc78ae-94e3-4a16-936a-133d059acfac"
	if err := a.AddUser(core.User{UserID: "u-1", XrayUUID: uuid}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	want := DeriveSecret(uuid, "www.cloudflare.com")
	if got := a.users["u-1"]; got != want {
		t.Errorf("user secret: got %q want %q", got, want)
	}
}

func TestAddUserSkipsWhenNoUUID(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{UserID: "u-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if len(a.users) != 0 {
		t.Errorf("user without XrayUUID should not be tracked")
	}
}

func TestAddUserBeforeDomain_StoresSentinel(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	a := New(Config{}, logger) // no Domain
	if err := a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if a.users["u-1"] != "" {
		t.Errorf("expected sentinel empty secret when domain unknown, got %q", a.users["u-1"])
	}
}

func TestRemoveUser(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	_ = a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-1"})
	if err := a.RemoveUser("u-1"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	if len(a.users) != 0 {
		t.Errorf("user not removed")
	}
}

func TestApplyInbound_RejectsMissingDomain(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{})
	if err := a.ApplyInbound(body); err == nil || !strings.Contains(err.Error(), "domain is required") {
		t.Errorf("expected domain-required error, got %v", err)
	}
}

func TestApplyInbound_RejectsMalformedJSON(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.ApplyInbound([]byte("{not json")); err == nil {
		t.Errorf("expected parse error")
	}
}

func TestApplyInbound_DomainChangeClearsUsers(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	_ = a.AddUser(core.User{UserID: "u-1", XrayUUID: "uuid-1"})
	if len(a.users) != 1 {
		t.Fatalf("setup: user not added")
	}

	body, _ := json.Marshal(map[string]any{"domain": "www.google.com"})
	if err := a.ApplyInbound(body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	// Domain change rotates secrets — users cleared, panel re-pushes.
	if len(a.users) != 0 {
		t.Errorf("domain change should clear users (panel re-pushes), got %d", len(a.users))
	}
	if a.cfg.Inbound.Domain != "www.google.com" {
		t.Errorf("Domain not updated: %q", a.cfg.Inbound.Domain)
	}
}

func TestApplyInbound_SameDomain_NoUsersWithSentinel_NoOp(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"domain": "www.cloudflare.com"})
	if err := a.ApplyInbound(body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.started {
		t.Errorf("same-domain ApplyInbound with no pending users should not have started")
	}
}
