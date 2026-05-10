// Package heartbeat polls the panel's /api/internal/nodes/me/status
// endpoint to detect operator-initiated deletion (or a CA mismatch from
// a panel rebuild) and triggers a clean shutdown when the panel reports
// the node is gone.
//
// Why pull-from-agent and not push-from-panel:
//   - The agent already runs an HTTPS server; adding outbound polling
//     keeps the panel-side stateless, no per-node connection bookkeeping.
//   - When the panel is rebuilt with a new CA, the panel's *push* attempts
//     fail at the TLS layer, but the agent never learns why. A pull lets
//     the agent see the explicit 410 / 401 response.
//
// Self-destruct policy (deliberately conservative):
//   - Only an explicit HTTP 410 Gone counts toward "delete me." Network
//     errors, timeouts, 5xx responses, and 401 are NOT counted as 410.
//     This keeps panel-restarts and brief outages from killing nodes.
//   - 3 consecutive 410s (default ~3 min at 60s interval) before exit.
//
// Failsafe: setting ICE_NODE_DISABLE_HEARTBEAT=1 disables the loop. Use
// this if the heartbeat itself ever misbehaves; the agent will just be
// orphaned-but-running until you SSH in to clean up.
package heartbeat

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Config bundles everything the loop needs. PanelURL is the public URL
// of the panel (e.g. https://panel.example.com); we tack on the
// `/api/internal/nodes/me/status` path internally.
type Config struct {
	PanelURL       string
	HeartbeatToken string
	// Optional: nil means use http.DefaultClient with a 10s timeout. Tests
	// inject a recording client. Production callers should leave nil.
	HTTPClient *http.Client
	// Interval between polls. Defaults to 60s.
	Interval time.Duration
	// How many consecutive 410s before triggering OnGone. Defaults to 3.
	GoneThreshold int
	// Called when self-destruct conditions are met. The runner is
	// expected to start a graceful shutdown (stop adapters, then exit).
	OnGone func(reason string)
}

const (
	defaultInterval = 60 * time.Second
	defaultGone     = 3
	defaultTimeout  = 10 * time.Second
)

// Run blocks until ctx is cancelled. Returns nil — heartbeat failures
// are non-fatal and only logged; OnGone is the single way the agent
// learns "you should stop."
func Run(ctx context.Context, cfg Config, logger *slog.Logger) {
	if cfg.PanelURL == "" || cfg.HeartbeatToken == "" {
		logger.Info("heartbeat: disabled (payload lacks panelUrl/heartbeatToken)")
		return
	}
	interval := cfg.Interval
	if interval <= 0 {
		interval = defaultInterval
	}
	threshold := cfg.GoneThreshold
	if threshold <= 0 {
		threshold = defaultGone
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: defaultTimeout}
	}
	url := strings.TrimRight(cfg.PanelURL, "/") + "/api/internal/nodes/me/status"

	logger.Info("heartbeat: starting",
		"interval", interval.String(),
		"goneThreshold", threshold,
		"panelUrl", cfg.PanelURL,
	)

	gone := 0
	tick := time.NewTimer(0) // fire immediately on start
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}

		status, err := pollOnce(ctx, client, url, cfg.HeartbeatToken)
		switch {
		case err != nil:
			// Network error / timeout / parse fail — DO NOT count as gone.
			logger.Warn("heartbeat: poll failed (panel unreachable, ignoring)", "err", err)
		case status == "active":
			if gone > 0 {
				logger.Info("heartbeat: panel says active, resetting gone counter")
			}
			gone = 0
		case status == "disabled":
			// Admin disabled the node — agent stays alive but logs at info
			// so operator can see the state. No counter increment.
			logger.Info("heartbeat: panel says disabled (node soft-paused — staying alive)")
			gone = 0
		case status == "gone":
			gone++
			logger.Warn("heartbeat: panel says gone", "consecutive", gone, "threshold", threshold)
			if gone >= threshold && cfg.OnGone != nil {
				cfg.OnGone("panel returned 410 Gone for this node")
				return
			}
		default:
			logger.Warn("heartbeat: unknown status", "status", status)
		}

		tick.Reset(interval)
	}
}

// pollOnce returns the high-level status string the loop cares about:
// "active", "disabled", "gone", or an error for everything else.
//
// 401 (bad token) is NOT mapped to "gone" — that case usually means the
// agent's payload is from a different panel install and the right thing
// is to log loudly and let an admin re-bootstrap. Auto-destructing on
// 401 would be too aggressive: any future panel-side bug that broke
// HMAC verification globally would silently kill every node in the
// fleet at once.
func pollOnce(ctx context.Context, client *http.Client, url, token string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusGone:
		// Drain so the connection can be reused.
		_, _ = io.Copy(io.Discard, resp.Body)
		return "gone", nil
	case http.StatusUnauthorized:
		_, _ = io.Copy(io.Discard, resp.Body)
		return "", errors.New("panel returned 401 — token invalid (likely orphaned payload)")
	case http.StatusOK:
		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			return "", err
		}
		switch body.Status {
		case "active", "disabled":
			return body.Status, nil
		default:
			return "", errors.New("unexpected status field: " + body.Status)
		}
	default:
		_, _ = io.Copy(io.Discard, resp.Body)
		return "", errors.New("unexpected http status: " + resp.Status)
	}
}
