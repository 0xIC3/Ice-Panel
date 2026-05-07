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
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os/exec"
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
	// Used both when BinaryPath is set (subprocess mode) and when the server
	// runs as an external systemd unit (slice 24b2: ApplyInbound rewrites
	// this file and asks systemd to restart the unit).
	ConfigPath string

	// Hostname is the public FQDN that Hysteria's ACME (Let's Encrypt http-01)
	// uses for cert issuance. Required for ApplyInbound to render config.yaml.
	// Set at install time via env (HYSTERIA_HOSTNAME) — the panel never pushes
	// this; it's identity for the node, not per-inbound config.
	Hostname string

	// ACMEEmail is the contact address Let's Encrypt uses for renewal warnings.
	ACMEEmail string

	// ListenPort is the public UDP port Hysteria listens on. Default: 443.
	ListenPort int

	// ServiceUnit is the systemd unit name to restart after rewriting
	// ConfigPath (slice 24b2). When empty, ApplyInbound writes the YAML but
	// skips the restart — useful for tests, dry-runs, and the case where the
	// adapter manages hysteria as its own subprocess.
	ServiceUnit string

	// RunCmd is the injectable command runner used to invoke `systemctl
	// restart <ServiceUnit>`. Defaults to running the real binary via os/exec.
	// Tests inject a fake to assert which commands fire without spawning anything.
	RunCmd RunCmdFunc
}

// RunCmdFunc executes an external command synchronously. The default impl
// shells out via os/exec; tests pass a recorder fake.
type RunCmdFunc func(ctx context.Context, name string, args ...string) error

type Adapter struct {
	cfg    Config
	logger *slog.Logger

	mu      sync.RWMutex
	users   map[string]userEntry // key: HysteriaPassword
	inbound InboundConfig        // last applied panel config; zero value = none

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
	if cfg.RunCmd == nil {
		cfg.RunCmd = defaultRunCmd
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]userEntry),
	}
}

// defaultRunCmd shells out via os/exec. Production path; tests inject a fake.
func defaultRunCmd(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %w (output: %s)", name, args, err, string(out))
	}
	return nil
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

// ApplyInbound parses panel-pushed Hysteria config, diffs vs the last applied
// state, and on change rewrites ConfigPath + restarts the systemd unit.
//
// Idempotent: byte-equivalent input → no-op (no file rewrite, no systemctl).
//
// Hysteria's runtime config lives under a separate systemd unit (typically
// `hysteria-server.service`), not under node-agent. node-agent has the
// privileges to rewrite the YAML and trigger `systemctl restart` — that's
// what RunCmd does. The cross-unit dependency is intentional: the upstream
// hysteria binary self-manages ACME, and we don't want to fight it.
//
// When ConfigPath is empty, the adapter logs and returns nil without writing
// — useful for callback-only nodes (config managed by hand).
func (a *Adapter) ApplyInbound(rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("hysteria ApplyInbound: parse cfg: %w", err)
	}
	newInbound := wire.toInboundConfig()

	a.mu.Lock()
	defer a.mu.Unlock()

	if inboundEqual(a.inbound, newInbound) {
		a.logger.Info("hysteria ApplyInbound: config unchanged, skipping rewrite")
		return nil
	}

	if a.cfg.ConfigPath == "" {
		a.logger.Info("hysteria ApplyInbound: ConfigPath not set — accepting in memory only",
			"obfs", newInbound.ObfsPassword != "",
			"masquerade", newInbound.MasqueradeURL != "")
		a.inbound = newInbound
		return nil
	}

	blob, err := renderConfig(a.cfg, newInbound)
	if err != nil {
		return fmt.Errorf("hysteria ApplyInbound: render: %w", err)
	}
	if err := writeConfig(a.cfg.ConfigPath, blob); err != nil {
		return fmt.Errorf("hysteria ApplyInbound: write %s: %w", a.cfg.ConfigPath, err)
	}

	a.inbound = newInbound
	a.logger.Info("hysteria ApplyInbound: config rewritten",
		"path", a.cfg.ConfigPath,
		"obfs", newInbound.ObfsPassword != "",
		"masquerade", newInbound.MasqueradeURL != "",
		"bandwidth", newInbound.BrutalUpMbps > 0 || newInbound.BrutalDownMbps > 0)

	if a.cfg.ServiceUnit == "" {
		a.logger.Info("hysteria ApplyInbound: ServiceUnit not set — skipping restart",
			"hint", "set HYSTERIA_SERVICE_UNIT to enable auto-restart")
		return nil
	}

	// Background context: the inbound HTTP request that triggered this call
	// may have a short deadline, but we want hysteria to come back up even
	// if the caller times out (matches the xray adapter's pattern).
	if err := a.cfg.RunCmd(context.Background(), "systemctl", "restart", a.cfg.ServiceUnit); err != nil {
		return fmt.Errorf("hysteria ApplyInbound: restart %s: %w", a.cfg.ServiceUnit, err)
	}
	a.logger.Info("hysteria ApplyInbound: service restarted", "unit", a.cfg.ServiceUnit)
	return nil
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
