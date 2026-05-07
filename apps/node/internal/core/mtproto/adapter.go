package mtproto

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"sync"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/core/subprocess"
)

const Name = "mtproto"

// Config is per-instance settings for the MTProtoAdapter.
type Config struct {
	// BinaryPath to the `mtg` executable. Empty → config-only mode.
	BinaryPath string

	// ConfigPath is where the generated mtg TOML is written.
	ConfigPath string

	// Inbound is the static settings (domain, secret, ports). The Secret
	// must be set before mtg can bind — adapter waits on first ApplyInbound
	// from panel before starting.
	Inbound InboundConfig

	// RunCmd is the injectable command runner for stats scraping.
	// Defaults to os/exec; tests inject a fake.
	RunCmd RunCmdFunc
}

type RunCmdFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

// Adapter implements core.CoreAdapter for MTProto.
//
// Per-user state is intentionally absent — mtg is single-secret upstream,
// so AddUser/RemoveUser are no-ops. The adapter just tracks which user
// IDs are "associated with this inbound" for GetStats book-keeping.
type Adapter struct {
	cfg    Config
	logger *slog.Logger

	mu      sync.Mutex
	users   map[string]struct{} // userIDs that the panel has assigned to this inbound
	started bool

	proc *subprocess.Subprocess
}

func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.RunCmd == nil {
		cfg.RunCmd = defaultRunCmd
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]struct{}),
	}
}

func defaultRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func (a *Adapter) Name() string { return Name }

// Start writes the initial config (if Domain+Secret are set) and spawns
// mtg. If either is empty, defers — first ApplyInbound activates it.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg.Inbound.Domain == "" || a.cfg.Inbound.Secret == "" {
		a.logger.Info("mtproto adapter: domain or secret not set — waiting for ApplyInbound from panel")
		return nil
	}
	return a.regenerateAndRestartLocked(ctx)
}

func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.started = false
	if a.proc == nil {
		return nil
	}
	err := a.proc.Stop(ctx)
	a.proc = nil
	return err
}

// AddUser is a panel-side bookkeeping no-op for MTProto. The mtg server
// has no per-user concept — every user with this inbound's URI uses the
// same shared secret. We track userIDs so GetStats can report them as
// "online" without claiming per-user byte counters we can't measure.
func (a *Adapter) AddUser(user core.User) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.users[user.UserID] = struct{}{}
	return nil
}

func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.users, userID)
	return nil
}

// inboundCfgWire mirrors `MtprotoInboundCfg` in shared/transport.ts.
type inboundCfgWire struct {
	Domain string `json:"domain"`
	// Secret is computed by the panel from the inbound ID + domain
	// (DeriveSecret) and pushed here. The agent doesn't re-derive — it
	// trusts the panel's value, so panel and agent stay in sync even if
	// derivation logic ever changes.
	Secret string `json:"secret"`
}

// ApplyInbound updates the masquerade domain and secret. Both can change
// simultaneously (panel rotates the secret on domain change).
func (a *Adapter) ApplyInbound(rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("mtproto ApplyInbound: parse cfg: %w", err)
	}
	if wire.Domain == "" {
		return fmt.Errorf("mtproto ApplyInbound: domain is required")
	}
	if wire.Secret == "" {
		return fmt.Errorf("mtproto ApplyInbound: secret is required")
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if a.cfg.Inbound.Domain == wire.Domain && a.cfg.Inbound.Secret == wire.Secret {
		a.logger.Info("mtproto ApplyInbound: config unchanged, skipping")
		return nil
	}

	a.cfg.Inbound.Domain = wire.Domain
	a.cfg.Inbound.Secret = wire.Secret
	a.logger.Info("mtproto ApplyInbound: config changed, regenerating + restarting",
		"domain", wire.Domain)
	return a.regenerateAndRestartLocked(context.Background())
}

// GetStats returns tracked users with zero counters. Real per-user
// metrics aren't available — mtg's Prometheus endpoint exposes only
// global counters for a single-secret instance. A future commit may add
// inbound-level (not user-level) counters by scraping the Prometheus
// endpoint, but that information doesn't fit the per-user core.Stats
// shape.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	users := make([]core.UserStats, 0, len(a.users))
	for id := range a.users {
		users = append(users, core.UserStats{UserID: id})
	}
	return &core.Stats{Users: users}, nil
}

func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.started {
		return false
	}
	if a.cfg.BinaryPath == "" {
		return true
	}
	return a.proc != nil && a.proc.Running()
}

// regenerateAndRestartLocked must be called with a.mu held. mtg has no
// SIGHUP-based hot reload for the secret — restart on every config
// change. Domain changes are infrequent (admin-driven) so the
// brief downtime is acceptable.
func (a *Adapter) regenerateAndRestartLocked(ctx context.Context) error {
	blob, err := renderConfig(a.cfg.Inbound)
	if err != nil {
		return fmt.Errorf("render mtproto config: %w", err)
	}
	if a.cfg.ConfigPath != "" {
		if err := writeConfig(a.cfg.ConfigPath, blob); err != nil {
			return err
		}
	}
	if a.cfg.BinaryPath == "" {
		a.started = true
		a.logger.Info("mtproto config written (config-only mode)")
		return nil
	}

	// Restart cleanly — there's no graceful reload path in mtg for the
	// secret. ~1s downtime is fine; users' clients reconnect.
	if a.proc != nil {
		_ = a.proc.Stop(ctx)
		a.proc = nil
	}
	proc := subprocess.New(subprocess.Config{
		Name:   Name,
		Binary: a.cfg.BinaryPath,
		Args:   []string{"run", a.cfg.ConfigPath},
		Logger: a.logger,
	})
	if err := proc.Start(ctx); err != nil {
		return fmt.Errorf("start mtg: %w", err)
	}
	a.proc = proc
	a.started = true
	a.logger.Info("mtproto (mtg) (re)started", "domain", a.cfg.Inbound.Domain)
	return nil
}
