---
name: Hysteria2 reference for Slice 11 HysteriaAdapter
description: Operational reference for managing Hysteria2 server-side. Auth-callback flow (we use this), Brutal CC, port hopping, stats API. Snapshot 2026-05-04.
type: reference
originSessionId: 652e2420-3ff6-4298-a3e6-48489cb0137f
---
Hysteria2 = QUIC-based proxy with Brutal CC, salamander obfs, port hopping. Snapshot 2026-05-04 from `v2.hysteria.network/docs/`. Refresh before slice 11.

## Auth callback flow (CRITICAL — what we use)

**Server config:**
```yaml
auth:
  type: http
  http:
    url: http://node-agent:9000/auth
    insecure: false
```

**Server → Panel (POST, application/json):**
```json
{ "addr": "1.2.3.4:44556", "auth": "user-secret", "tx": 123456 }
```
- `addr`: client source IP:port
- `auth`: opaque credential client sent
- `tx`: client's declared upload rate (bytes/sec)

**Panel → Server response (200 OK + JSON):**
```json
{ "ok": true, "id": "user-uuid" }
```
- `ok: false` rejects (still HTTP 200)
- `id`: appears in logs and Stats API. **This is our user UUID.**

**For our HysteriaAdapter:** node-agent runs HTTP server on `:9000/auth` (or Unix socket), checks user state in local cache (synced from panel), returns `{ok, id}`.

## Auth modes (alternatives, don't use)
- `password`: single shared password (no multi-user)
- `userpass`: hardcoded `user1: pass1` map in YAML (per-change requires reload)
- `command`: spawn binary per auth (slow)

## Brutal congestion control

```yaml
bandwidth:
  up: 1 gbps
  down: 1 gbps
ignoreClientBandwidth: false
```
- Units: `bps/kbps/mbps/gbps/tbps`
- Per-direction effective rate = `min(server, client)` UNLESS `ignoreClientBandwidth: true` (then server wins)
- Section absent on both sides → Brutal off, BBR/Reno via `congestion.type` takes over
- `speedTest: true` enables `/speedtest` endpoint for tuning

**Per-user caps:** YAML only has global `bandwidth`. For differentiation we must either: (a) one inbound per cap tier, or (b) add to roadmap a future feature where panel issues per-user signed tokens encoding rate (Hysteria doesn't natively support this yet).

## Salamander obfuscation

```yaml
obfs:
  type: salamander
  salamander:
    password: cry_me_a_r1ver
```
- XOR-based scrambler keyed by SHA-256(password) + per-packet salt
- Makes traffic look like uniformly random UDP — defeats QUIC version-byte fingerprinting
- Passwords must match exactly (any whitespace breaks)

## Port hopping

```yaml
listen: :20000-50000          # range (Linux only — auto nftables)
listen: :4443,4444,4445       # explicit
listen: :1234,5000-6000,7044  # mixed
```

Auto-installs nftables/iptables NAT redirect from range → first port. Manual fallback:
```bash
iptables -t nat -A PREROUTING -i eth0 -p udp --dport 20000:50000 \
  -j REDIRECT --to-ports 443
```

QUIC's connection migration (CIDs not 4-tuples) makes port-hopping seamless for clients.

## Masquerade (DPI evasion / decoy)

If non-Hysteria HTTP request arrives, return what masquerade dictates. **Without `masquerade:` block → always 404.**

| Type | Use |
|---|---|
| `file` | static file server, `dir: /www/masq` |
| `proxy` | reverse-proxy to real site (`url: https://news.ycombinator.com/`) — best for our nodes |
| `string` | fixed response with `content/headers/statusCode` |
| (omit) | 404 |

```yaml
masquerade:
  type: proxy
  proxy:
    url: https://news.ycombinator.com/
    rewriteHost: true
  listenHTTP: :80
  listenHTTPS: :443
  forceHTTPS: true
```

## ACL

```yaml
acl:
  inline:
    - reject(geoip:cn)
    - reject(geosite:netflix)
    - direct(suffix:google.com)
    - default(8.8.8.8, *, 1.1.1.1)
```

Grammar: `outbound(address[, proto/port[, hijack_address]])`
- Outbounds: `direct`, `reject`, `default`, or named outbound
- Address: IP, CIDR, domain (exact/wildcard/`suffix:`), `geoip:`, `geosite:`, `all`
- Proto/port: `tcp`, `udp/53`, `tcp/80`, `udp/20000-30000`, `*/443`

## Outbounds

```yaml
outbounds:
  - name: my_socks5
    type: socks5
    socks5: { addr: shady.proxy.ru:1080, username: x, password: y }
  - name: my_direct
    type: direct
    direct: { mode: auto, bindIPv4: 1.2.3.4, bindDevice: eth0 }
```
Types: `direct`, `socks5`, `http`. Single-hop only.

## Traffic Stats API ⭐

```yaml
trafficStats:
  listen: 127.0.0.1:9999
  secret: super_long_random_secret
```

All requests: `Authorization: <secret>` header.

| Endpoint | Returns |
|---|---|
| `GET /traffic` | `{ "user-uuid": { "tx": 514, "rx": 4017 } }` lifetime counters |
| `GET /traffic?clear=1` | Same + atomically resets — perfect for delta polling |
| `GET /online` | `{ "user-uuid": 2 }` concurrent QUIC connections per user |
| `POST /kick` body `["user-uuid"]` | Disconnect users (they can reconnect — reject in auth too) |
| `GET /dump/streams` | Per-stream snapshot (state, user, conn ID, addr, tx/rx, timestamps) |

**Our adapter polling pattern:** every 30s `GET /traffic?clear=1`, write deltas to `node_user_usage_history`.

## TLS setup

Three modes (mutually exclusive):

**File:**
```yaml
tls: { cert: /path/to/cert.pem, key: /path/to/key.pem, sniGuard: strict }
```

**ACME auto:**
```yaml
acme:
  domains: [vpn.example.com]
  email: ops@example.com
  ca: letsencrypt        # or zerossl
  type: http             # http (port 80) | tls (443) | dns
```

**Self-signed + pinSHA256:**
- Server: any cert
- Client: `tls.insecure: true` + `tls.pinSHA256: <sha256-fingerprint>`. Insecure alone is unsafe.

## QUIC tuning

```yaml
quic:
  initStreamReceiveWindow: 8388608      # 8 MB default
  maxStreamReceiveWindow:  8388608
  initConnReceiveWindow:   20971520     # 20 MB default
  maxConnReceiveWindow:    20971520
  maxIdleTimeout: 30s
  maxIncomingStreams: 1024
```
Stream:conn ratio ~ 2/5. For 10 Gbps: `26843545 / 67108864`.

## Subscription URL format

```
hysteria2://[auth@]hostname[:port]/?key=value&key=value...
```

Query params:
- `obfs` — `salamander` only
- `obfs-password`
- `sni`
- `insecure` — `1`/`0`
- `pinSHA256` — pinned cert fingerprint

Auth percent-encoded; for `userpass` use `user:password@`. Multi-port: `:123,5000-6000`.

**Verbatim from docs:**
```
hysteria2://user@example.com:123,5000-6000/?insecure=1&obfs=salamander&obfs-password=gawrgura&pinSHA256=deadbeef&sni=real.example.com
```

URI **must NOT** include client modes (socks5/http listeners) or bandwidth — those are user-local.

## Performance / kernel tuning

**UDP socket buffers (Linux):**
```bash
sysctl -w net.core.rmem_max=16777216    # 16 MB minimum
sysctl -w net.core.wmem_max=16777216
# For 10 Gbps: 134217728 (128 MB)
```

Without this → "failed to sufficiently increase receive buffer size" + capped throughput.

**BBR (for outbound TCP, not Hysteria's QUIC):**
```bash
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
```

**Bind 443 without root:**
```bash
sudo setcap cap_net_bind_service=+ep ./hysteria
```

**File descriptors:** `LimitNOFILE=1048576` in systemd unit.

**Process priority (real-time):**
```ini
[Service]
CPUSchedulingPolicy=rr
CPUSchedulingPriority=99
```

## Logging

CLI flags / env-vars (NOT YAML):
- `--log-level` / `HYSTERIA_LOG_LEVEL`: `debug | info | warn | error` (default `info`)
- `--log-format` / `HYSTERIA_LOG_FORMAT`: `console | json` (default `console`)

**Our adapter:** launch with `--log-format json`, capture stdout/stderr. Stable fields: `level`, `ts`, `msg`, plus context (`remote`, `id`, `error`).

## Reference: panel-style production config

```yaml
listen: :20000-50000
acme:
  domains: [vpn.example.com]
  email: ops@example.com
  ca: letsencrypt
  type: http

obfs:
  type: salamander
  salamander:
    password: cry_me_a_r1ver

bandwidth:
  up: 1 gbps
  down: 1 gbps
ignoreClientBandwidth: true

auth:
  type: http
  http:
    url: http://127.0.0.1:9000/hysteria/auth
    insecure: false

trafficStats:
  listen: 127.0.0.1:9999
  secret: <random-32-bytes>

masquerade:
  type: proxy
  proxy:
    url: https://news.ycombinator.com/
    rewriteHost: true

quic:
  initStreamReceiveWindow: 26843545
  maxStreamReceiveWindow:  26843545
  initConnReceiveWindow:   67108864
  maxConnReceiveWindow:    67108864
  maxIdleTimeout: 30s
```

## Key takeaways for HysteriaAdapter (Slice 11)

1. **Auth: `type: http`** → node-agent's local HTTP server on `127.0.0.1:9000/auth`. Returns `{ok, id}` where `id` is our user UUID. **NO restart needed when adding/removing users** — pure in-memory state in node-agent.
2. **Stats poll**: cron in node-agent → `GET /traffic?clear=1` every 30s → atomic snapshot+reset → push deltas via mTLS to panel. Use `secret` header.
3. **Per-user bandwidth caps in v1: ONE rate for all** (`ignoreClientBandwidth: true`). Per-user differentiation = future feature, possibly via auth-token claims.
4. **Subscription URI**: `hysteria2://<password>@<host>:<port>/?obfs=salamander&obfs-password=...&sni=...&insecure=0`. Multi-port for hopping: `host:p1,p2-p3`.
5. **Node provisioning script** must run sysctl for UDP buffers + setcap for port 443.
6. **Default masquerade**: `type: proxy` to a configurable benign URL (e.g. user's choice from a list: HN, Wikipedia, etc.).
7. **Process management**: launch via supervisor (systemd unit at first; later supervisord-equivalent in node-agent for in-process control). Auto-restart on crash. Capture `--log-format json` stdout to ship to panel via mTLS.

## Sources

- v2.hysteria.network/docs/ (Full Server Config, Full Client Config, Server/Client getting started, Traffic Stats API, ACL, Port Hopping, Performance, URI Scheme)
- github.com/apernet/hysteria
- DeepWiki: apernet/hysteria Core Components

## Refresh before slice 11

Re-fetch URI scheme + Traffic Stats endpoints — these are the parts most likely to evolve. Check release notes since 2026-05-04.
