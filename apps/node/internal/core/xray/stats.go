package xray

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// statsQueryTimeout caps the runtime of `xray api statsquery`. Generous —
// the call is local IPC, but the binary may be momentarily blocked during
// a config reload.
const statsQueryTimeout = 5 * time.Second

// xrayStatsResponse mirrors the JSON returned by:
//
//	xray api statsquery -server 127.0.0.1:<port> -pattern user -reset
//
// Each entry's `name` is `user>>><email>>>traffic>>>{uplink,downlink}`,
// where we set `email` = userId in renderConfig (see config.go).
//
// Wire shape (xray-core /infra/conf/cmd):
//
//	{"stat":[{"name":"user>>>...>>>uplink","value":"123"},...]}
//
// `value` is JSON string-of-number — xray uses int64 internally and JSON's
// 53-bit float would lose precision past ~9 PB.
type xrayStatsResponse struct {
	Stat []xrayStatEntry `json:"stat"`
}

// `value` arrives as a bare JSON number from `xray api statsquery` (not a
// string, despite older xray-core docs hinting otherwise). Go's strict
// strconv-int Unmarshal would fail to decode int → string, killing the
// whole batch. `json.Number` accepts both numbers and stringified numbers,
// covering the few xray-core forks that quote their values.
type xrayStatEntry struct {
	Name  string      `json:"name"`
	Value json.Number `json:"value"`
}

// queryUserStats invokes `xray api statsquery` and returns per-user byte
// counters. The `-reset` flag is intentional: it drains the counter on
// every read so we can ingest deltas instead of resetting state ourselves.
//
// Returns a map keyed by userId (email) → (uplinkBytes, downlinkBytes).
// Missing entries imply zero. Errors propagate; callers decide whether to
// degrade or surface.
func queryUserStats(
	ctx context.Context,
	run RunCmdFunc,
	binary string,
	apiPort int,
) (map[string]userByteCounters, error) {
	if binary == "" {
		return nil, fmt.Errorf("xray binary path is empty")
	}
	ctx, cancel := context.WithTimeout(ctx, statsQueryTimeout)
	defer cancel()

	out, err := run(ctx, binary,
		"api", "statsquery",
		"-server", fmt.Sprintf("127.0.0.1:%d", apiPort),
		"-pattern", "user",
		"-reset",
	)
	if err != nil {
		return nil, fmt.Errorf("xray api statsquery: %w (%s)", err, strings.TrimSpace(string(out)))
	}

	var resp xrayStatsResponse
	if err := json.Unmarshal(out, &resp); err != nil {
		return nil, fmt.Errorf("parse statsquery output: %w (raw: %s)", err, strings.TrimSpace(string(out)))
	}

	result := make(map[string]userByteCounters, len(resp.Stat)/2)
	for _, e := range resp.Stat {
		userID, dir, ok := parseStatName(e.Name)
		if !ok {
			continue // unknown shape — skip rather than fail the whole batch
		}
		bytes, perr := e.Value.Int64()
		if perr != nil {
			continue
		}
		entry := result[userID]
		switch dir {
		case "uplink":
			entry.UplinkBytes += bytes
		case "downlink":
			entry.DownlinkBytes += bytes
		}
		result[userID] = entry
	}
	return result, nil
}

// parseStatName extracts (userId, "uplink"|"downlink") from a stat key like
// `user>>><userId>>>traffic>>>uplink`. Returns ok=false on any other shape.
func parseStatName(name string) (userID, direction string, ok bool) {
	const sep = ">>>"
	parts := strings.Split(name, sep)
	if len(parts) != 4 || parts[0] != "user" || parts[2] != "traffic" {
		return "", "", false
	}
	if parts[3] != "uplink" && parts[3] != "downlink" {
		return "", "", false
	}
	return parts[1], parts[3], true
}

// parseInt64String parses xray's stringified int64 stat values. xray emits
// them as JSON strings deliberately to dodge the 53-bit float precision
// limit at the protocol boundary.
func parseInt64String(s string) (int64, error) {
	var n int64
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("invalid stat value %q", s)
		}
		n = n*10 + int64(c-'0')
	}
	return n, nil
}

type userByteCounters struct {
	UplinkBytes   int64
	DownlinkBytes int64
}
