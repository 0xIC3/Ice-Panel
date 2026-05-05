package xray

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"sync"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/core/subprocess"
)

const Name = "xray"

// Config is the per-instance settings for an XrayAdapter.
type Config struct {
	// BinaryPath to the `xray` executable. If empty, the adapter runs in
	// "config-only" mode (writes config.json but doesn't spawn xray) — useful
	// for tests and dev environments without xray installed.
	BinaryPath string

	// ConfigPath is where the generated config.json is written. The xray
	// subprocess is invoked with `xray run -c <ConfigPath>`.
	ConfigPath string

	// Inbound is the static REALITY+VLESS settings; slice 23 will move these
	// into the inbounds table per node.
	Inbound InboundConfig
}

type Adapter struct {
	cfg    Config
	logger *slog.Logger

	mu    sync.Mutex
	users map[string]xrayClient // key: userId

	proc *subprocess.Subprocess
}

// New builds an adapter; nothing is spawned until Start is called.
func New(cfg Config, logger *slog.Logger) *Adapter {
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]xrayClient),
	}
}

func (a *Adapter) Name() string { return Name }

// Start writes the initial (empty-clients) config to disk and spawns xray.
// In config-only mode (no BinaryPath) it just writes the config.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.regenerateAndRestartLocked(ctx)
}

// Stop terminates the subprocess. The on-disk config is left in place.
func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.proc == nil {
		return nil
	}
	err := a.proc.Stop(ctx)
	a.proc = nil
	return err
}

// AddUser registers the user with the adapter, regenerates the config, and
// restarts the xray subprocess. Brief (~1s) downtime per call.
//
// Idempotent: re-adding the same user with the same UUID is a no-op (no
// restart triggered).
func (a *Adapter) AddUser(user core.User) error {
	if user.XrayUUID == "" {
		// User has no Xray credentials — nothing to do.
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	existing, exists := a.users[user.UserID]
	desired := xrayClient{
		ID:    user.XrayUUID,
		Email: user.UserID,
		Flow:  a.cfg.Inbound.Flow,
	}
	if a.cfg.Inbound.Flow == "" {
		// Apply default; withDefaults isn't called on cfg directly so we mirror it here.
		desired.Flow = "xtls-rprx-vision"
	}
	if exists && existing == desired {
		return nil
	}
	a.users[user.UserID] = desired
	return a.regenerateAndRestartLocked(context.Background())
}

// RemoveUser drops the user from the state, regenerates, and restarts.
// Idempotent: removing an unknown user is a no-op.
func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.users[userID]; !ok {
		return nil
	}
	delete(a.users, userID)
	return a.regenerateAndRestartLocked(context.Background())
}

// GetStats returns a list of tracked users with zero counters.
// Slice 17 does not implement gRPC stats query — Phase 3 optimisation.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	users := make([]core.UserStats, 0, len(a.users))
	for id := range a.users {
		users = append(users, core.UserStats{UserID: id})
	}
	return &core.Stats{Users: users}, nil
}

// Healthy reports whether the subprocess is running. In config-only mode
// (no BinaryPath) the adapter is considered healthy as soon as Start has
// successfully written the config.
func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg.BinaryPath == "" {
		// Config-only mode: healthy after Start ran (which sets users to non-nil).
		return a.users != nil
	}
	return a.proc != nil && a.proc.Running()
}

// regenerateAndRestartLocked must be called with a.mu held. It writes the
// current users-map to ConfigPath and (re)starts the xray subprocess.
func (a *Adapter) regenerateAndRestartLocked(ctx context.Context) error {
	clients := sortedClients(a.users)
	blob, err := renderConfig(a.cfg.Inbound, clients)
	if err != nil {
		return fmt.Errorf("render xray config: %w", err)
	}
	if a.cfg.ConfigPath != "" {
		if err := writeConfig(a.cfg.ConfigPath, blob); err != nil {
			return err
		}
	}

	if a.cfg.BinaryPath == "" {
		// Config-only mode: nothing more to do.
		a.logger.Info("xray config written (config-only mode)", "users", len(clients))
		return nil
	}

	// Stop existing subprocess if running.
	if a.proc != nil {
		if err := a.proc.Stop(ctx); err != nil {
			a.logger.Warn("xray stop failed during restart", "err", err)
		}
		a.proc = nil
	}

	proc := subprocess.New(subprocess.Config{
		Name:   Name,
		Binary: a.cfg.BinaryPath,
		Args:   []string{"run", "-c", a.cfg.ConfigPath},
		Logger: a.logger,
	})
	if err := proc.Start(ctx); err != nil {
		return fmt.Errorf("start xray: %w", err)
	}
	a.proc = proc
	a.logger.Info("xray (re)started", "users", len(clients))
	return nil
}

// sortedClients returns the user map in deterministic order so successive
// renders produce byte-identical config files (helpful for tests + diff'ing).
func sortedClients(users map[string]xrayClient) []xrayClient {
	out := make([]xrayClient, 0, len(users))
	for _, c := range users {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Email < out[j].Email })
	return out
}
