// Package hysteria implements CoreAdapter for the Hysteria 2 proxy core.
//
// Architecture:
//   - The agent maintains an in-memory map of `password → userId`. AddUser /
//     RemoveUser mutate this map.
//   - Hysteria server runs as a subprocess (when BinaryPath is configured)
//     and is told to authenticate clients via HTTP callback. The callback
//     URL points at our local auth server (see auth.go).
//   - When a client tries to connect, Hysteria POSTs to /auth on our local
//     server with the supplied password; we look it up in the map.
//
// Adding/removing users does NOT restart Hysteria — the state map is updated
// live and the next auth callback uses the new state.
package hysteria

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sync"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/core/subprocess"
)

const Name = "hysteria"

// Config holds per-instance settings. Defaults applied in New if zero.
type Config struct {
	// AuthCallbackHost is where the local /auth HTTP server binds.
	// Default: "127.0.0.1" (loopback only — Hysteria subprocess on same host).
	AuthCallbackHost string

	// AuthCallbackPort for the /auth HTTP server. Default: 9000.
	AuthCallbackPort int

	// BinaryPath to the `hysteria` executable. If empty, the adapter runs in
	// callback-only mode (no subprocess) — useful for tests and for slice 11
	// before slice 13 wires real subprocess + config generation.
	BinaryPath string

	// ConfigPath is the YAML config file passed to `hysteria server -c`.
	// Only used when BinaryPath is non-empty.
	ConfigPath string
}

type Adapter struct {
	cfg    Config
	logger *slog.Logger

	mu    sync.RWMutex
	users map[string]userEntry // key: HysteriaPassword

	callbackSrv *http.Server
	proc        *subprocess.Subprocess // hysteria subprocess; nil when BinaryPath is empty
}

type userEntry struct {
	UserID   string
	Username string
}

// New builds an adapter with defaults filled in.
func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.AuthCallbackHost == "" {
		cfg.AuthCallbackHost = "127.0.0.1"
	}
	if cfg.AuthCallbackPort == 0 {
		cfg.AuthCallbackPort = 9000
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]userEntry),
	}
}

func (a *Adapter) Name() string { return Name }

// Start brings up the auth-callback server, then optionally spawns the
// hysteria subprocess via the shared subprocess package.
func (a *Adapter) Start(ctx context.Context) error {
	if err := a.startAuthCallback(); err != nil {
		return fmt.Errorf("start auth callback: %w", err)
	}

	if a.cfg.BinaryPath == "" {
		a.logger.Info("hysteria binary not configured — callback-only mode")
		return nil
	}

	proc := subprocess.New(subprocess.Config{
		Name:   Name,
		Binary: a.cfg.BinaryPath,
		Args:   []string{"server", "-c", a.cfg.ConfigPath},
		Logger: a.logger,
	})
	if err := proc.Start(ctx); err != nil {
		// Best-effort: tear down the auth callback we just started.
		_ = a.stopAuthCallback(context.Background())
		return err
	}
	a.mu.Lock()
	a.proc = proc
	a.mu.Unlock()
	return nil
}

// Stop gracefully shuts down the subprocess (if any) and then the callback
// server, with a 5s deadline before SIGKILL.
func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	proc := a.proc
	a.proc = nil
	a.mu.Unlock()

	var firstErr error
	if proc != nil {
		if err := proc.Stop(ctx); err != nil {
			firstErr = err
		}
	}
	if err := a.stopAuthCallback(ctx); err != nil && firstErr == nil {
		firstErr = err
	}
	return firstErr
}

func (a *Adapter) AddUser(user core.User) error {
	if user.HysteriaPassword == "" {
		// User has no Hysteria credentials — nothing to do for this protocol.
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.users[user.HysteriaPassword] = userEntry{
		UserID:   user.UserID,
		Username: user.Username,
	}
	return nil
}

func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	for password, entry := range a.users {
		if entry.UserID == userID {
			delete(a.users, password)
		}
	}
	return nil
}

func (a *Adapter) GetStats() (*core.Stats, error) {
	// TODO slice 13: pull real counters from Hysteria's stats API.
	a.mu.RLock()
	defer a.mu.RUnlock()
	users := make([]core.UserStats, 0, len(a.users))
	for _, e := range a.users {
		users = append(users, core.UserStats{UserID: e.UserID})
	}
	return &core.Stats{Users: users}, nil
}

// Healthy reports whether the adapter is ready to serve traffic.
// In callback-only mode (no BinaryPath), only the auth-callback server
// must be up. With BinaryPath set, the hysteria subprocess must also
// be running.
func (a *Adapter) Healthy() bool {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.callbackSrv == nil {
		return false
	}
	if a.cfg.BinaryPath != "" {
		if a.proc == nil || !a.proc.Running() {
			return false
		}
	}
	return true
}

// LookupByPassword consults the in-memory state for a given password.
// Used by the local /auth callback handler.
func (a *Adapter) LookupByPassword(password string) (userID string, ok bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	entry, found := a.users[password]
	if !found {
		return "", false
	}
	return entry.UserID, true
}
