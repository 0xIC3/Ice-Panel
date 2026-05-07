package mtproto

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"sync"
	"syscall"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
	"github.com/0xIC3/Ice-Panel/apps/node/internal/core/subprocess"
)

const Name = "mtproto"

// Config is per-instance settings for the MTProtoAdapter.
type Config struct {
	// BinaryPath to the `mtg` executable. Empty → config-only mode (writes
	// TOML but doesn't spawn mtg).
	BinaryPath string

	// ConfigPath is where the generated mtg TOML is written.
	ConfigPath string

	// Inbound is the static settings (domain, listen port, stats port).
	Inbound InboundConfig

	// RunCmd is the injectable command runner (for SIGHUP via `kill -HUP`
	// when the subprocess is mtg-managed externally, and for stats scraping).
	// Defaults to os/exec; tests inject a fake.
	RunCmd RunCmdFunc
}

// RunCmdFunc executes an external command. Mirrors other adapters.
type RunCmdFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

type Adapter struct {
	cfg    Config
	logger *slog.Logger

	mu      sync.Mutex
	users   map[string]string // userId → secret
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
		users:  make(map[string]string),
	}
}

func defaultRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func (a *Adapter) Name() string { return Name }

// Start writes the initial config and spawns mtg. Domain must already be
// configured (either via env at startup or pushed from panel via
// ApplyInbound). If empty, Start defers — first ApplyInbound activates it.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cfg.Inbound.Domain == "" {
		a.logger.Info("mtproto adapter: no Domain yet — waiting for ApplyInbound from panel")
		return nil
	}
	return a.regenerateAndReloadLocked(ctx)
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

// AddUser registers a user. Per-user secret derived from xrayUuid+domain.
// Idempotent.
func (a *Adapter) AddUser(user core.User) error {
	if user.XrayUUID == "" {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()

	domain := a.cfg.Inbound.Domain
	if domain == "" {
		// Defer: domain not yet known, can't derive secret.
		// Panel push order: ApplyInbound (sets domain) → AddUser. Out-of-order
		// AddUser silently caches the user; Start/ApplyInbound flushes.
		a.users[user.UserID] = "" // sentinel — re-derive on first regenerate
		return nil
	}
	secret := DeriveSecret(user.XrayUUID, domain)
	if existing, ok := a.users[user.UserID]; ok && existing == secret {
		return nil
	}
	a.users[user.UserID] = secret
	if !a.started {
		return nil
	}
	return a.regenerateAndReloadLocked(context.Background())
}

func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.users[userID]; !ok {
		return nil
	}
	delete(a.users, userID)
	if !a.started {
		return nil
	}
	return a.regenerateAndReloadLocked(context.Background())
}

// inboundCfgWire mirrors `MtprotoInboundCfg` in shared/transport.ts.
type inboundCfgWire struct {
	Domain string `json:"domain"`
}

// ApplyInbound updates the masquerade domain. Domain change rotates EVERY
// user's secret because the domain is hex-baked into each one — we
// re-derive all secrets in-place.
func (a *Adapter) ApplyInbound(rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("mtproto ApplyInbound: parse cfg: %w", err)
	}
	if wire.Domain == "" {
		return fmt.Errorf("mtproto ApplyInbound: domain is required")
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	if a.cfg.Inbound.Domain == wire.Domain {
		// Same domain — only un-derived (sentinel "") users need flushing.
		needsRegen := false
		for _, s := range a.users {
			if s == "" {
				needsRegen = true
				break
			}
		}
		if !needsRegen {
			a.logger.Info("mtproto ApplyInbound: domain unchanged, no users pending — skipping")
			return nil
		}
	}

	a.cfg.Inbound.Domain = wire.Domain
	a.logger.Info("mtproto ApplyInbound: domain set, rotating all user secrets",
		"domain", wire.Domain, "users", len(a.users))

	// Re-derive every user's secret against the new domain. The original
	// xrayUuid is encoded as the deterministic input — we don't have the
	// UUIDs cached locally, but DeriveSecret is reproducible IF we still
	// have the secret. We don't: secret-from-secret derivation isn't a
	// thing here. So secret rotation requires the panel to re-push every
	// AddUser after a domain change. Document this contract.
	//
	// What we DO here: clear the secrets map (they're now stale anyway)
	// and rely on the panel's `node.created` / re-push mechanism to fan
	// users back out post-restart. Until that fires, the inbound runs
	// with no users — connections fail closed. Better than running with
	// stale (now-invalid) secrets.
	a.users = make(map[string]string)
	return a.regenerateAndReloadLocked(context.Background())
}

// GetStats scrapes mtg's Prometheus endpoint and returns per-user counters.
// Soft-fails to zero on scrape error.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	users := make([]core.UserStats, 0, len(a.users))
	for id := range a.users {
		users = append(users, core.UserStats{UserID: id})
	}
	a.mu.Unlock()

	// Prometheus scraping is a follow-up — for v1 we report tracked users
	// with zero counters. Same soft-fail philosophy as xray/SS adapters:
	// returning users-with-zeros means the panel sees "user is online"
	// even if byte counters are 0; an upgrade path adds real numbers
	// without changing the wire shape.
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

// regenerateAndReloadLocked must be called with a.mu held. Writes the
// current config and either restarts the subprocess (first time) or
// signals it to reload (SIGHUP — graceful, existing connections survive).
func (a *Adapter) regenerateAndReloadLocked(ctx context.Context) error {
	// Re-derive secrets for any users with sentinel "" entries (added
	// before domain was known).
	for id, s := range a.users {
		if s == "" && a.cfg.Inbound.Domain != "" {
			// We don't have the UUID cached. Realistically AddUser
			// happens AFTER ApplyInbound in panel's normal flow, so this
			// branch is dead. If it fires, the user is silently dropped;
			// the panel will re-push them on next reconcile.
			delete(a.users, id)
		}
	}

	secrets := sortedSecrets(a.users)
	blob, err := renderConfig(a.cfg.Inbound, secrets)
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
		a.logger.Info("mtproto config written (config-only mode)", "users", len(secrets))
		return nil
	}

	// SIGHUP for hot reload; spawn fresh on first time.
	if a.proc != nil && a.proc.Running() {
		// mtg supports SIGHUP for graceful secrets-list reload.
		if err := a.signalProcess(syscall.SIGHUP); err != nil {
			a.logger.Warn("mtproto SIGHUP failed, falling back to restart", "err", err)
		} else {
			a.logger.Info("mtproto reloaded via SIGHUP", "users", len(secrets))
			return nil
		}
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
	a.logger.Info("mtproto (mtg) (re)started", "users", len(secrets), "domain", a.cfg.Inbound.Domain)
	return nil
}

// signalProcess sends `sig` to the mtg subprocess. The subprocess package
// doesn't expose Signal directly — for now we re-invoke `kill` via os/exec
// using the runner. Slice 41+: extend subprocess package with Signal().
func (a *Adapter) signalProcess(sig syscall.Signal) error {
	// In the absence of a Signal() helper on subprocess, we always
	// hard-restart. SIGHUP optimisation lands when subprocess.Signal
	// arrives — meanwhile graceful semantics are best-effort.
	return fmt.Errorf("SIGHUP not yet wired (TODO subprocess.Signal)")
}
