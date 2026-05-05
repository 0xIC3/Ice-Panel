package hysteria

import (
	"io"
	"log/slog"
	"net/http"
	"testing"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
)

func newTestAdapter(t *testing.T) *Adapter {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(Config{}, logger)
}

func TestAddUserStoresPassword(t *testing.T) {
	a := newTestAdapter(t)

	if err := a.AddUser(core.User{
		UserID:           "u-1",
		Username:         "alice",
		HysteriaPassword: "secret",
	}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	id, ok := a.LookupByPassword("secret")
	if !ok || id != "u-1" {
		t.Errorf("Lookup: got id=%q ok=%v want id=u-1 ok=true", id, ok)
	}
}

func TestAddUserSkipsWhenNoHysteriaPassword(t *testing.T) {
	a := newTestAdapter(t)

	// User with only Xray credentials — Hysteria adapter should ignore.
	if err := a.AddUser(core.User{UserID: "u-2", XrayUUID: "uuid"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	stats, _ := a.GetStats()
	if len(stats.Users) != 0 {
		t.Errorf("user without HysteriaPassword should not be tracked, got %d users", len(stats.Users))
	}
}

func TestAddUserIsIdempotent(t *testing.T) {
	a := newTestAdapter(t)

	user := core.User{UserID: "u-3", HysteriaPassword: "p"}
	_ = a.AddUser(user)
	_ = a.AddUser(user)
	_ = a.AddUser(user)

	stats, _ := a.GetStats()
	if len(stats.Users) != 1 {
		t.Errorf("expected 1 user after 3x AddUser, got %d", len(stats.Users))
	}
}

func TestRemoveUserClearsPassword(t *testing.T) {
	a := newTestAdapter(t)
	_ = a.AddUser(core.User{UserID: "u-4", HysteriaPassword: "p"})

	if err := a.RemoveUser("u-4"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}

	if _, ok := a.LookupByPassword("p"); ok {
		t.Errorf("password should be cleared after RemoveUser")
	}
}

func TestRemoveUserIsIdempotent(t *testing.T) {
	a := newTestAdapter(t)
	if err := a.RemoveUser("never-added"); err != nil {
		t.Errorf("RemoveUser of unknown id should be a no-op, got %v", err)
	}
}

func TestPasswordChangeReplacesEntry(t *testing.T) {
	a := newTestAdapter(t)

	_ = a.AddUser(core.User{UserID: "u-5", HysteriaPassword: "old"})
	// Re-add same user with rotated password — old entry should be cleared
	// after RemoveUser, then new entry written.
	_ = a.RemoveUser("u-5")
	_ = a.AddUser(core.User{UserID: "u-5", HysteriaPassword: "new"})

	if _, ok := a.LookupByPassword("old"); ok {
		t.Errorf("old password should not be valid after rotation")
	}
	if id, ok := a.LookupByPassword("new"); !ok || id != "u-5" {
		t.Errorf("new password should map to u-5, got id=%q ok=%v", id, ok)
	}
}

func TestGetStatsReportsTrackedUsers(t *testing.T) {
	a := newTestAdapter(t)
	_ = a.AddUser(core.User{UserID: "a", HysteriaPassword: "p1"})
	_ = a.AddUser(core.User{UserID: "b", HysteriaPassword: "p2"})

	stats, err := a.GetStats()
	if err != nil {
		t.Fatalf("GetStats: %v", err)
	}
	if len(stats.Users) != 2 {
		t.Errorf("expected 2 users, got %d", len(stats.Users))
	}
}

func TestNameMatchesProtocol(t *testing.T) {
	a := newTestAdapter(t)
	if a.Name() != Name {
		t.Errorf("Name: got %q want %q", a.Name(), Name)
	}
}

func TestHealthyBeforeStart(t *testing.T) {
	a := newTestAdapter(t)
	if a.Healthy() {
		t.Errorf("Healthy: expected false before Start (callback server is nil)")
	}
}

func TestHealthyAfterCallbackStart(t *testing.T) {
	a := newTestAdapter(t)
	// Simulate a started callback server without a subprocess (BinaryPath="").
	a.callbackSrv = &http.Server{}
	if !a.Healthy() {
		t.Errorf("Healthy: expected true with callback up and no subprocess configured")
	}
}
