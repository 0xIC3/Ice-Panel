---
name: Mieru reference for Slice 40 MieruAdapter
description: Operational reference for Mieru (enfein/mieru) — stealth proxy with random TCP/UDP packet shapes. Multi-user via mita server, SDK-based clients. Snapshot 2026-05-07.
type: reference
---
Mieru = stealth proxy designed to defeat traffic-analysis fingerprinting via randomised packet shapes and timing. Repo: `enfein/mieru`. License: GPL-3.0. Snapshot 2026-05-07. Refresh before slice 40 ships.

## Architecture in one sentence

`Client (mieru) → AEAD-encrypted + random-padded TCP or UDP → mita server → upstream SOCKS5/HTTP`

The encryption layer is an XChaCha20-Poly1305 AEAD with **per-packet random length padding** — every packet looks different even for the same payload. No "long stream of constant-size frames" pattern that DPI can latch onto.

## Why it exists (vs SS2022 / Trojan / Naive)

Active probing resistance + traffic shape resistance:
- **SS2022** — random ciphertext but constant frame size → length-distribution analysis defeats it
- **Trojan / Naive** — disguise as TLS/HTTP2; passive DPI fooled but active probing tests reveal proxy
- **Mieru** — random packet shapes + random timing + AEAD; both passive and active probing fail

Trade-off: Mieru's traffic doesn't *look like* anything legitimate. It looks like *random bytes*. On networks where any non-recognised traffic is blocked (some corporate firewalls, certain national DPI), Mieru fails closed. Best for networks that drop *known-bad* traffic but pass *unknown* traffic.

## Server: `mita`

`mita` is the server daemon. Verified CLI subcommands (per `docs/operation.md`):

```
mita apply config <path-to-json>    # load JSON config, store as protobuf internally
mita describe config                 # display current settings
mita start                           # launch the proxy daemon
mita stop                            # halt the daemon
mita status                          # service status
mita reload                          # graceful reload of users/logging (no traffic interruption)
mita get connections                 # list active connections
mita get users                       # last-active + 1d/30d up/down per user
mita get quotas                      # per-user usage limits and consumed
mita get metrics                     # generic metrics dump
```

For per-user stats integration in our adapter we want `mita get users` (returns the per-user up/down totals) — earlier draft of this doc said `mita get-metrics --output json` which doesn't exist as a single command.

## ⚠️ CORRECTION (2026-05-07): config is JSON, not YAML

Earlier draft claimed YAML. It's wrong — verified against
`enfein/mieru/docs/operation.md`. Configs are written as JSON files and
applied via `mita apply config <path.json>`. mita then stores its own
encoded copy as protobuf at `/etc/mita/server.conf.pb`; we never touch
that file directly.

Server config (`/etc/mita/server.json`):

```json
{
  "portBindings": [
    { "port": 2012, "protocol": "TCP" },
    { "port": 2012, "protocol": "UDP" }
  ],
  "users": [
    { "name": "alice", "password": "<password>" },
    { "name": "bob", "password": "<password>" }
  ],
  "mtu": 1400,
  "loggingLevel": "INFO"
}
```

Multi-user is **flat list of (name, password) pairs** in `users` array. Per-user features upstream supports but we don't surface today:
- `allowPrivateIP` — bool, lets user reach private LAN ranges
- `allowLoopbackIP` — bool, lets user reach 127.0.0.0/8
- `quotas: [{days, megabytes}]` — per-user traffic caps. Could integrate with our `users.trafficLimitBytes` in a future commit; today we cap globally on the panel side and just hand mita the user list.

**MTU minimum upstream is 1280** (was 576 in an earlier draft of this doc — wrong, verified per upstream).

## Per-user model — what fits CoreAdapter

Per-user adds = config rewrite + `mita reload`:
1. Append `{name: <userid>, password: <derived-from-xrayUuid>}` to `users:` list
2. Atomic write `server.yaml`
3. `mita reload` (or `systemctl reload mita`) — graceful, no session drop on existing users

Pattern matches Naive (Caddyfile rewrite + `caddy reload`) very closely. **`mita reload` IS graceful** — existing connections continue under their old credentials until the user disconnects, new connections use the new config.

**Password derivation:** mieru uses bytes directly as the AEAD key after KDF; we can pass `user.xrayUuid` as the password (string), mita hashes to fixed-length internally. Same approach as our SS2022 shortcut. Verify before slice 40 — re-read `enfein/mieru/docs/server.md` user-add example.

## Stats / per-user accounting

Upstream provides per-user stats via three CLI subcommands:

```
mita get users      # last-active timestamps + 1-day and 30-day up/down totals per user
mita get quotas     # daily/weekly limits + current usage per user
mita get metrics    # generic metrics dump (format unverified — to inspect on a real install)
```

**Implication for our adapter:** `GetStats` should shell out to `mita get users` and parse. Output format isn't documented as JSON in the upstream README — likely human-readable table that we'd parse, OR we hit `mita get metrics` for a more structured dump. **Verify on first VPS install** which one yields JSON.

For now (slice 40 v1) the adapter reports tracked userIDs with zero counters; real metric scraping is a follow-up.

## URI format

Mieru's clients (mieru-cli, GoMieru-Android, mieru-iOS) consume a **JSON profile**, not a URI:

```json
{
  "profiles": [{
    "profileName": "ice-eu-1",
    "user": { "name": "alice", "password": "<base64>" },
    "servers": [{
      "ipAddress": "se1.example.com",
      "portBindings": [
        { "port": 2012, "protocol": "TCP" },
        { "port": 2012, "protocol": "UDP" }
      ]
    }],
    "mtu": 1400
  }]
}
```

**This breaks our URI-list subscription pattern.** Options:
1. Generate one JSON-per-mieru-inbound, ship via `?format=mieru-json` (custom format) — single endpoint, clients import file
2. Mieru-as-link via custom `mieru://` scheme. **Upstream doesn't define one.** Hiddify discussion mentions community proposals (`mieru://name:password@host:port`) but unofficial.
3. Sing-box is adding mieru outbound (status as of 2026-05 — verify) — if shipped, our singbox formatter handles mieru via the universal subscription URL. Best long-term path.

**For slice 40 v1:** ship `?format=mieru-json` returning an importable profile. Add native singbox/clash support when those projects officially merge mieru outbounds.

## Build vs prebuilt

Prebuilt releases at `enfein/mieru/releases`:
- Linux amd64/arm64/armv7 binaries, ~10 MB statically linked Go
- Cadence: monthly
- Versioned (semver-ish); `mita` and `mieru` (client) ship in same release

Building from source:
- Standard Go module, `go build ./cmd/mita ./cmd/mieru`
- ~30s on a modern machine, no Chromium-style multi-hour pain
- Worth pinning a version in `bootstrap-mieru.sh` and rebuilding on bump

## Operational gotchas

1. **MTU matters.** Default 1400 leaves headroom on most paths. If users on PPPoE or weird VPN see slow throughput, drop MTU to 1280. Server-side setting; clients negotiate.

2. **TCP vs UDP toggle.** Inbound spec is per-port-per-protocol. If admin opens TCP only and client tries UDP, no fallback — silent timeout. Recommend opening both protocols on the same port number; server-side cost is trivial.

3. **Replay window.** AEAD includes a nonce; mieru tracks recent nonces server-side to reject replay. Window ~60s. Same NAT-roaming issue as SS2022 — clients moving cellular↔Wi-Fi may see brief packet rejection.

4. **No HTTP impersonation, no TLS.** Traffic looks like random bytes on `:2012`. On an AUP-strict VPS this is fine; on a network that whitelists known protocols it dies.

5. **Logging quiet by default.** mita's default `INFO` level is very chatty about per-connection events but doesn't print user passwords. Don't bump to `DEBUG` in prod — it does log.

6. **Single binary, dual purpose.** Same `mita` binary is used as systemd service. Don't run two instances on the same host without different config paths + ports.

## Relation to existing adapters

Closest analogue: **Naive (slice 20)** — config rewrite + reload, no in-protocol per-user quotas, multi-user via flat list. Significant differences:
- Naive needs Caddy + plugin fork; mieru is single Go binary
- Naive has TLS as cover; mieru has nothing-as-cover (random bytes)
- Naive has no per-user stats upstream; mieru has `mita get-metrics` (much better)

Implementation-wise the slice-40 adapter is a **simplified Naive adapter**: `MieruConfig`, AddUser/RemoveUser → rewrite YAML + `mita reload`, GetStats → shell out to `mita get-metrics`. ~3-5 days solo per the roadmap estimate.

## What we'd ship in slice 40 v1

- `bootstrap-mieru.sh`: download release tarball, install `mita` to `/usr/local/bin`, drop systemd unit pointing at `/etc/mita/server.yaml`
- node-agent `MieruAdapter`: implement CoreAdapter (Start/Stop/AddUser/RemoveUser/ApplyInbound/GetStats/Healthy)
- panel-side wire: `MieruInboundCfg { mtu?: number, portBindings?: [{port,protocol}] }`
- subscription endpoint: `?format=mieru-json` route generating importable profile
- frontend: `MieruInboundConfig` form (mostly port + MTU)
- per-user: reuse `user.xrayUuid` as password, `user.username` as name

## Refresh policy

Mieru is solo-author (enfein) — release cadence varies. Re-read README + USAGE.md before slice 40, particularly:
- Server config schema (YAML field names have churned)
- `mita` CLI subcommand names
- Whether sing-box has merged mieru outbound (status changes the URI question above)
- Whether community has settled on a `mieru://` URI scheme

Verify before slice 40:
- Exact `password` format (raw bytes? base64? string-hashed?)
- `mita reload` graceful behaviour for user removal (does kicking happen?)
- Metrics endpoint output format (JSON? human?)
