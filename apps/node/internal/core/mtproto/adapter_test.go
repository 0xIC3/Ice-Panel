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
	domain := "www.cloudflare.com"
	return New(Config{
		Inbound: InboundConfig{
			Domain:     domain,
			Secret:     DeriveSecret("inbound-1", domain),
			ListenPort: 443,
			StatsPort:  3129,
		},
	}, logger)
}

func TestNameMatchesProtocol(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

// Per single-secret architecture, AddUser/RemoveUser are bookkeeping no-ops
// — mtg has no per-user concept.
func TestAddUser_BookkeepingOnly(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.AddUser(core.User{UserID: "u-1"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if _, ok := a.users["u-1"]; !ok {
		t.Errorf("AddUser should track userID for GetStats reporting")
	}
}

func TestRemoveUser_BookkeepingOnly(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	_ = a.AddUser(core.User{UserID: "u-1"})
	if err := a.RemoveUser("u-1"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	if _, ok := a.users["u-1"]; ok {
		t.Errorf("RemoveUser did not clear userID")
	}
}

func TestApplyInbound_RejectsMissingDomain(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"secret": "ee01"})
	if err := a.ApplyInbound(body); err == nil || !strings.Contains(err.Error(), "domain is required") {
		t.Errorf("expected domain-required error, got %v", err)
	}
}

func TestApplyInbound_RejectsMissingSecret(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	body, _ := json.Marshal(map[string]any{"domain": "www.cloudflare.com"})
	if err := a.ApplyInbound(body); err == nil || !strings.Contains(err.Error(), "secret is required") {
		t.Errorf("expected secret-required error, got %v", err)
	}
}

func TestApplyInbound_RejectsMalformedJSON(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	if err := a.ApplyInbound([]byte("{not json")); err == nil {
		t.Errorf("expected parse error")
	}
}

func TestApplyInbound_DomainAndSecretChangeUpdatesAdapter(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	newDomain := "www.google.com"
	newSecret := DeriveSecret("inbound-1", newDomain)
	body, _ := json.Marshal(map[string]any{
		"domain": newDomain,
		"secret": newSecret,
	})
	if err := a.ApplyInbound(body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.cfg.Inbound.Domain != newDomain {
		t.Errorf("Domain not updated: %q", a.cfg.Inbound.Domain)
	}
	if a.cfg.Inbound.Secret != newSecret {
		t.Errorf("Secret not updated: %q", a.cfg.Inbound.Secret)
	}
	if !a.started {
		t.Errorf("started should be true after regenerate")
	}
}

func TestApplyInbound_NoOpOnIdenticalConfig(t *testing.T) {
	a := newConfigOnlyAdapter(t)
	domain := a.cfg.Inbound.Domain
	secret := a.cfg.Inbound.Secret
	body, _ := json.Marshal(map[string]any{"domain": domain, "secret": secret})
	if err := a.ApplyInbound(body); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	if a.started {
		t.Errorf("identical apply should not have started")
	}
}
