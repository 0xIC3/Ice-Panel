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
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
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
	cmd         *exec.Cmd // hysteria subprocess; nil before Start / when BinaryPath is empty
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
// hysteria subprocess. Subprocess lifecycle bound to ctx via CommandContext.
func (a *Adapter) Start(ctx context.Context) error {
	if err := a.startAuthCallback(); err != nil {
		return fmt.Errorf("start auth callback: %w", err)
	}

	if a.cfg.BinaryPath == "" {
		a.logger.Info("hysteria binary not configured — callback-only mode")
		return nil
	}

	cmd := exec.CommandContext(ctx, a.cfg.BinaryPath, "server", "-c", a.cfg.ConfigPath)
	cmd.Stdout = newLogWriter(a.logger, slog.LevelInfo, "hysteria")
	cmd.Stderr = newLogWriter(a.logger, slog.LevelError, "hysteria")
	if err := cmd.Start(); err != nil {
		// Best-effort: tear down the auth callback we just started.
		_ = a.stopAuthCallback(context.Background())
		return fmt.Errorf("spawn hysteria: %w", err)
	}
	a.cmd = cmd
	a.logger.Info("hysteria subprocess started", "pid", cmd.Process.Pid)
	return nil
}

// Stop gracefully shuts down the subprocess (if any) and then the callback
// server, with a 5s deadline before SIGKILL.
func (a *Adapter) Stop(ctx context.Context) error {
	var firstErr error

	if a.cmd != nil && a.cmd.Process != nil {
		if err := a.cmd.Process.Signal(syscall.SIGTERM); err != nil {
			a.logger.Warn("sigterm hysteria failed", "err", err)
		}

		done := make(chan error, 1)
		go func() { done <- a.cmd.Wait() }()

		select {
		case <-done:
			// graceful exit
		case <-time.After(5 * time.Second):
			_ = a.cmd.Process.Kill()
			firstErr = errors.New("hysteria did not stop in time, killed")
		case <-ctx.Done():
			_ = a.cmd.Process.Kill()
			firstErr = ctx.Err()
		}
		a.cmd = nil
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

// ───── log writer adapter ─────

// newLogWriter returns an io.Writer that splits on newlines and forwards each
// line to slog at the given level. Used to capture hysteria's stdout/stderr.
func newLogWriter(logger *slog.Logger, level slog.Level, source string) io.Writer {
	return &logWriter{logger: logger, level: level, source: source}
}

type logWriter struct {
	logger *slog.Logger
	level  slog.Level
	source string
	buf    []byte
}

func (w *logWriter) Write(p []byte) (int, error) {
	w.buf = append(w.buf, p...)
	for {
		idx := indexNewline(w.buf)
		if idx < 0 {
			break
		}
		line := string(w.buf[:idx])
		w.buf = w.buf[idx+1:]
		w.logger.Log(context.Background(), w.level, line, "source", w.source)
	}
	return len(p), nil
}

func indexNewline(b []byte) int {
	for i, c := range b {
		if c == '\n' {
			return i
		}
	}
	return -1
}
