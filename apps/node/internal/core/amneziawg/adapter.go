package amneziawg

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/0xIC3/Ice-Panel/apps/node/internal/core"
)

const Name = "amneziawg"

const defaultSyncTimeout = 10 * time.Second

// Config is the per-instance settings for an AmneziaWGAdapter.
type Config struct {
	// Inbound is the static interface settings (keys, ports, obfuscation).
	// Slice 23 will move these into the inbounds table per node.
	Inbound InboundConfig

	// ConfigPath is where awg-quick / awg syncconf read the interface config
	// from. Default "/etc/amneziawg/<iface>.conf".
	ConfigPath string

	// AwgBin / AwgQuickBin / SystemctlBin are CLI paths. When AwgQuickBin is
	// empty the adapter runs in **config-only mode**: it writes the config
	// file but never invokes any CLI. That mode is what tests and dev
	// environments without amneziawg installed use.
	AwgBin       string
	AwgQuickBin  string
	SystemctlBin string

	// SyncTimeout caps how long `awg syncconf` may run before we bail out
	// and trigger the systemctl-restart fallback. Default 10s.
	//
	// The fallback exists because we've seen `awg syncconf` hang on a known
	// kernel-module bug; without a timeout the panel queue would stall.
	SyncTimeout time.Duration

	// runCmd is an injection point for tests. nil → real exec.CommandContext.
	runCmd func(ctx context.Context, name string, args ...string) ([]byte, error)
}

// Adapter implements core.CoreAdapter for AmneziaWG.
type Adapter struct {
	cfg    Config
	logger *slog.Logger

	mu      sync.Mutex
	peers   map[string]Peer // key: userId
	started bool
}

func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.ConfigPath == "" {
		cfg.ConfigPath = fmt.Sprintf("/etc/amneziawg/%s.conf", cfg.Inbound.Interface)
		if cfg.Inbound.Interface == "" {
			cfg.ConfigPath = "/etc/amneziawg/awg0.conf"
		}
	}
	if cfg.SyncTimeout == 0 {
		cfg.SyncTimeout = defaultSyncTimeout
	}
	if cfg.runCmd == nil {
		cfg.runCmd = realRunCmd
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		peers:  make(map[string]Peer),
	}
}

func realRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	return out, err
}

func (a *Adapter) Name() string { return Name }

// Start writes the initial (no-peer) config and brings the awg interface up.
// In config-only mode (AwgQuickBin == "") it just writes the config.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if err := a.writeCurrentConfigLocked(); err != nil {
		return err
	}

	if a.cfg.AwgQuickBin != "" {
		if out, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "up", a.cfg.Inbound.Interface); err != nil {
			// awg-quick up is idempotent-ish — failing because the iface is
			// already up is fine. Anything else is a real error.
			if !strings.Contains(strings.ToLower(string(out)), "already exists") {
				return fmt.Errorf("awg-quick up %s failed: %w (%s)", a.cfg.Inbound.Interface, err, strings.TrimSpace(string(out)))
			}
		}
	}

	a.started = true
	a.logger.Info("amneziawg adapter started",
		"interface", a.cfg.Inbound.Interface,
		"managed", a.cfg.AwgQuickBin != "")
	return nil
}

// Stop tears the interface down. Safe to call multiple times.
func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.started = false

	if a.cfg.AwgQuickBin == "" {
		return nil
	}
	if _, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "down", a.cfg.Inbound.Interface); err != nil {
		// "iface not running" is expected on a clean stop after a failed start
		a.logger.Warn("awg-quick down returned non-zero (often safe)", "err", err)
	}
	return nil
}

// AddUser registers / updates a peer. No-op for users without amneziawg
// credentials. Idempotent.
func (a *Adapter) AddUser(user core.User) error {
	if user.AmneziaWGPublicKey == "" || user.AmneziaWGAllowedIP == "" {
		return nil
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	desired := Peer{
		PublicKey: user.AmneziaWGPublicKey,
		AllowedIP: ensureCIDR(user.AmneziaWGAllowedIP),
	}
	if existing, ok := a.peers[user.UserID]; ok && existing == desired {
		return nil
	}
	a.peers[user.UserID] = desired
	return a.regenerateAndSyncLocked(context.Background())
}

// RemoveUser drops the peer and reloads the interface. Idempotent.
func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.peers[userID]; !ok {
		return nil
	}
	delete(a.peers, userID)
	return a.regenerateAndSyncLocked(context.Background())
}

// GetStats currently returns just the tracked user list with zero counters.
// Per-user byte counters require parsing `awg show <iface> dump` — Phase 3.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	users := make([]core.UserStats, 0, len(a.peers))
	for id := range a.peers {
		users = append(users, core.UserStats{UserID: id})
	}
	return &core.Stats{Users: users}, nil
}

// Healthy reports whether the adapter has finished Start successfully and
// (when managed) the awg interface still exists.
func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	started := a.started
	managed := a.cfg.AwgQuickBin != ""
	iface := a.cfg.Inbound.Interface
	a.mu.Unlock()

	if !started {
		return false
	}
	if !managed {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := a.cfg.runCmd(ctx, a.cfg.AwgBin, "show", iface)
	return err == nil
}

// regenerateAndSyncLocked must be called with a.mu held. It writes the
// current config to disk and (when managed) reloads the running interface
// via `awg syncconf`, falling back to `systemctl restart awg-quick@<iface>`
// on failure or timeout.
func (a *Adapter) regenerateAndSyncLocked(ctx context.Context) error {
	if err := a.writeCurrentConfigLocked(); err != nil {
		return err
	}

	if a.cfg.AwgQuickBin == "" {
		a.logger.Info("amneziawg config written (config-only mode)", "peers", len(a.peers))
		return nil
	}

	if err := a.syncconfLocked(ctx); err != nil {
		a.logger.Warn("awg syncconf failed; falling back to systemctl restart", "err", err)
		return a.restartViaSystemctlLocked(ctx)
	}
	a.logger.Info("amneziawg synced", "peers", len(a.peers))
	return nil
}

func (a *Adapter) syncconfLocked(parent context.Context) error {
	ctx, cancel := context.WithTimeout(parent, a.cfg.SyncTimeout)
	defer cancel()

	stripped, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "strip", a.cfg.ConfigPath)
	if err != nil {
		return fmt.Errorf("awg-quick strip: %w (%s)", err, strings.TrimSpace(string(stripped)))
	}

	tmp, err := os.CreateTemp("", "ice-awg-syncconf-*.conf")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(stripped); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp: %w", err)
	}

	out, err := a.cfg.runCmd(ctx, a.cfg.AwgBin, "syncconf", a.cfg.Inbound.Interface, tmpPath)
	if err != nil {
		return fmt.Errorf("awg syncconf: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (a *Adapter) restartViaSystemctlLocked(parent context.Context) error {
	if a.cfg.SystemctlBin == "" {
		return errors.New("syncconf failed and no SystemctlBin configured for fallback")
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	unit := "awg-quick@" + a.cfg.Inbound.Interface
	out, err := a.cfg.runCmd(ctx, a.cfg.SystemctlBin, "restart", unit)
	if err != nil {
		return fmt.Errorf("systemctl restart %s: %w (%s)", unit, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (a *Adapter) writeCurrentConfigLocked() error {
	peers := sortedPeers(a.peers)
	blob, err := renderConfig(a.cfg.Inbound, peers)
	if err != nil {
		return fmt.Errorf("render amneziawg config: %w", err)
	}
	return writeConfig(a.cfg.ConfigPath, blob)
}

// sortedPeers returns peers in deterministic AllowedIP order so successive
// renders produce byte-identical configs.
func sortedPeers(in map[string]Peer) []Peer {
	out := make([]Peer, 0, len(in))
	for _, p := range in {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AllowedIP < out[j].AllowedIP })
	return out
}

// ensureCIDR appends /32 to a bare IP. Pass-through if already in CIDR form.
func ensureCIDR(ip string) string {
	if strings.Contains(ip, "/") {
		return ip
	}
	return ip + "/32"
}
