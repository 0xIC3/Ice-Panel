package amneziawg

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
)

func newTestAdapter(t *testing.T) (*Adapter, string) {
	t.Helper()
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "awg0.conf")
	a := New(Config{
		Inbound:    validInbound(),
		ConfigPath: cfgPath,
		// AwgQuickBin/AwgBin empty → config-only mode, no CLI is invoked.
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0" // ensure deterministic
	return a, cfgPath
}

func TestAdapter_StartWritesConfig(t *testing.T) {
	a, cfgPath := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	blob, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	if !strings.Contains(string(blob), "[Interface]") {
		t.Errorf("config missing [Interface] block: %s", blob)
	}
	if strings.Contains(string(blob), "[Peer]") {
		t.Errorf("expected no [Peer] before AddUser, got: %s", blob)
	}
	if !a.Healthy() {
		t.Errorf("adapter should be healthy after Start in config-only mode")
	}
}

func TestAdapter_AddUserSkipsWithoutCreds(t *testing.T) {
	a, _ := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	// Both fields missing → no-op.
	if err := a.AddUser(core.User{UserID: "u1"}); err != nil {
		t.Fatalf("AddUser empty: %v", err)
	}
	// Only public key, no IP → no-op.
	if err := a.AddUser(core.User{UserID: "u1", AmneziaWGPublicKey: "pub"}); err != nil {
		t.Fatalf("AddUser without IP: %v", err)
	}
	if len(a.peers) != 0 {
		t.Errorf("expected 0 peers, got %d", len(a.peers))
	}
}

func TestAdapter_AddRemoveUser(t *testing.T) {
	a, cfgPath := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}

	user := core.User{
		UserID:             "u-alice",
		AmneziaWGPublicKey: "pub-alice",
		AmneziaWGAllowedIP: "10.0.0.42",
	}
	if err := a.AddUser(user); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if len(a.peers) != 1 {
		t.Errorf("expected 1 peer, got %d", len(a.peers))
	}
	blob, _ := os.ReadFile(cfgPath)
	if !strings.Contains(string(blob), "PublicKey = pub-alice") ||
		!strings.Contains(string(blob), "AllowedIPs = 10.0.0.42/32") {
		t.Errorf("config missing alice peer: %s", blob)
	}

	// Idempotent re-add — same data, should not error.
	if err := a.AddUser(user); err != nil {
		t.Fatalf("AddUser repeat: %v", err)
	}
	if len(a.peers) != 1 {
		t.Errorf("expected still 1 peer after idempotent AddUser, got %d", len(a.peers))
	}

	if err := a.RemoveUser(user.UserID); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	if len(a.peers) != 0 {
		t.Errorf("expected 0 peers after RemoveUser, got %d", len(a.peers))
	}
	// Idempotent remove.
	if err := a.RemoveUser(user.UserID); err != nil {
		t.Fatalf("RemoveUser repeat: %v", err)
	}
}

func TestAdapter_AddUserWithCIDRIP(t *testing.T) {
	// Caller passes CIDR form already — adapter should not double-suffix.
	a, cfgPath := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := a.AddUser(core.User{
		UserID:             "u",
		AmneziaWGPublicKey: "pk",
		AmneziaWGAllowedIP: "10.0.0.5/32",
	}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	blob, _ := os.ReadFile(cfgPath)
	if strings.Contains(string(blob), "10.0.0.5/32/32") {
		t.Errorf("AllowedIPs got double-suffixed: %s", blob)
	}
	if !strings.Contains(string(blob), "AllowedIPs = 10.0.0.5/32") {
		t.Errorf("expected single /32 suffix: %s", blob)
	}
}

func TestAdapter_GetStats(t *testing.T) {
	a, _ := newTestAdapter(t)
	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	a.AddUser(core.User{UserID: "u1", AmneziaWGPublicKey: "p1", AmneziaWGAllowedIP: "10.0.0.2"})
	a.AddUser(core.User{UserID: "u2", AmneziaWGPublicKey: "p2", AmneziaWGAllowedIP: "10.0.0.3"})
	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if len(stats.Users) != 2 {
		t.Errorf("expected 2 user stat entries, got %d", len(stats.Users))
	}
}

func TestAdapter_HealthyBeforeStart(t *testing.T) {
	a, _ := newTestAdapter(t)
	if a.Healthy() {
		t.Errorf("expected Healthy=false before Start")
	}
}

func TestAdapter_HealthyManagedRunsCmd(t *testing.T) {
	dir := t.TempDir()
	calls := []string{}
	a := New(Config{
		Inbound:     validInbound(),
		ConfigPath:  filepath.Join(dir, "awg0.conf"),
		AwgBin:      "/usr/bin/awg",
		AwgQuickBin: "/usr/bin/awg-quick",
		runCmd: func(ctx context.Context, name string, args ...string) ([]byte, error) {
			calls = append(calls, name+" "+strings.Join(args, " "))
			return []byte(""), nil
		},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0"

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !a.Healthy() {
		t.Errorf("Healthy=false after Start with mocked runCmd returning success")
	}
	// Expect awg-quick up + awg show
	got := strings.Join(calls, "\n")
	if !strings.Contains(got, "awg-quick up awg0") {
		t.Errorf("expected `awg-quick up awg0` in calls:\n%s", got)
	}
	if !strings.Contains(got, "awg show awg0") {
		t.Errorf("expected `awg show awg0` in Healthy probe:\n%s", got)
	}
}

func TestAdapter_SyncconfFallbackToSystemctl(t *testing.T) {
	dir := t.TempDir()
	calls := []string{}
	syncconfFails := func(ctx context.Context, name string, args ...string) ([]byte, error) {
		calls = append(calls, name+" "+strings.Join(args, " "))
		// awg syncconf returns error; everything else succeeds.
		if name == "/usr/bin/awg" && len(args) > 0 && args[0] == "syncconf" {
			return []byte("kernel module hung"), errBoom
		}
		return []byte(""), nil
	}
	a := New(Config{
		Inbound:      validInbound(),
		ConfigPath:   filepath.Join(dir, "awg0.conf"),
		AwgBin:       "/usr/bin/awg",
		AwgQuickBin:  "/usr/bin/awg-quick",
		SystemctlBin: "/usr/bin/systemctl",
		runCmd:       syncconfFails,
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	a.cfg.Inbound.Interface = "awg0"

	if err := a.Start(context.Background()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := a.AddUser(core.User{
		UserID:             "u1",
		AmneziaWGPublicKey: "pk",
		AmneziaWGAllowedIP: "10.0.0.5",
	}); err != nil {
		t.Fatalf("AddUser: %v (expected fallback to succeed)", err)
	}
	got := strings.Join(calls, "\n")
	if !strings.Contains(got, "systemctl restart awg-quick@awg0") {
		t.Errorf("expected fallback systemctl restart, got:\n%s", got)
	}
}

type stubErr string

func (s stubErr) Error() string { return string(s) }

var errBoom = stubErr("boom")
