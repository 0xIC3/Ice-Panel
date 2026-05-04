---
name: NaiveProxy reference for Slice 20 NaiveProxyAdapter
description: Operational reference for managing NaiveProxy server-side. Multi-user only via Caddy fork — that's the architectural constraint to plan around.
type: reference
originSessionId: 652e2420-3ff6-4298-a3e6-48489cb0137f
---
NaiveProxy = HTTP/2 over **real Chromium** TLS stack. Snapshot 2026-05-04. Refresh before slice 20.

## Architecture in one sentence

`Browser → Naive client → (TCP+TLS, fingerprinted as real Chrome) → Caddy/HAProxy frontend → forwardproxy@naive plugin → upstream`

The big differentiator: **Naive *is* Chromium's network code**, not a uTLS imitation. ClientHello, ALPN, H2 SETTINGS, GOAWAY, PING, post-handshake messages — byte-for-byte identical to real Chrome because it's the same code.

## Multi-user — THE critical constraint

**Standalone `naive` binary as server is single-tenant.** Multi-user lives in **Caddy + `klzgrad/forwardproxy@naive`** fork:

```caddyfile
forward_proxy {
    basic_auth user1 password1
    basic_auth user2 password2
    basic_auth alice s3cret
    hide_ip
    hide_via
    probe_resistance
}
```

`basic_auth` directive can be repeated. All users share one cert, one port (typically 443), one frontend domain.

**Implications for our NaiveProxyAdapter (slice 20):**
- Adapter manages a Caddyfile (or Caddy admin API JSON) per inbound
- Add/remove user → regenerate config → `caddy reload --config /etc/caddy/Caddyfile` (graceful, no dropped sessions)
- **Per-user traffic accounting is NOT in upstream.** Two options, both painful:
  - Parse Caddy access logs (volume + auth-tag mapping fragile)
  - Patch forwardproxy@naive fork to emit per-user counters via Caddy admin endpoint (ongoing rebase cost)
- **No native online/offline kick.** Removing `basic_auth` line + reload doesn't drop existing sessions — they live until idle/tunnel timeout. Force-kick requires custom patch.

This makes NaiveProxyAdapter the **thickest** of the four adapters. Plan accordingly.

## CLI flags (from USAGE.txt)

| Flag | Purpose |
|---|---|
| `--listen=<URI>` | `socks://0.0.0.0:1080` default. Repeatable. `socks/http/redir` schemes. `redir` needs iptables, no auth. |
| `--proxy=<URI>` | Upstream proxy. Schemes: `http/https/quic/socks`. Chainable (multiple values). |
| `--insecure-concurrency=<N>` | Parallel tunnel connections. Throughput vs fingerprint trade. |
| `--extra-headers=...` | Extra CONNECT headers (CRLF-separated). |
| `--host-resolver-rules=...` | Static DNS overrides. |
| `--resolver-range=<CIDR>` | Default `100.64.0.0/10`. |
| `--tunnel-timeout=<sec>` | Default 1800 (Android 600). |
| `--idle-timeout=<sec>` | Default 600 (Android 300). |
| `--log[=path]` | Disabled by default (privacy). |
| `--log-net-log=<path>` | Chromium NetLog dump. |
| `--ssl-key-log-file=<path>` | TLS keys for Wireshark. |
| `--no-post-quantum` | Disable Kyber. |
| Positional `[/path/to/config.json]` | All flags also via JSON. |

**No `--padding` flag on the binary.** Padding is on by default when both sides advertise `padding` H2 header. Clients pass `padding=true/false` via subscription URI query.

## Padding protocol

Naive's tweak on top of standard HTTP/2:
- First **8 reads/8 writes** per stream: `[size_hi][size_lo][padding_size][data][zeros]`
- Padding 0–255 bytes random — flattens packet-length distributions
- H2 RST_STREAM padded to look like HEADERS
- CONNECT request headers padded 16–32 bytes; response 30–62
- Negotiated via `padding` H2 header — both peers must be Naive-aware
- Overhead: <1 KB per stream — negligible at proxy throughputs

## TLS setup (Caddy frontend)

Caddy handles ACME automatically — Let's Encrypt / ZeroSSL / OCSP stapling all transparent. `tls me@example.com` directive triggers issuance. **Real domain pointing at server is mandatory** — Naive's whole disguise depends on legitimate cert.

For shared 443 port: HAProxy SNI routing in front of Caddy on a back port (documented in upstream wiki).

## Build vs prebuilt

### Prebuilt releases (`klzgrad/naiveproxy/releases`)
- Cadence: monthly to bi-weekly, tracking Chromium stable
- Chromium pinning: each release notes "Rebased to Chromium X.Y.Z" — lag from stable usually days to weeks
- Platforms: Linux (arm/arm64/loong64/mips64el/mipsel/riscv64/**x64**), Android (arm64-v8a/armeabi-v7a/x86/x86_64)
- Sizes: Linux tarballs 2.89–3.25 MB (.tar.xz), Android APKs 2.99–3.5 MB; uncompressed binary ~10–15 MB
- **Upstream advisory:** *"Users should always use the latest version to keep signatures identical to Chrome."* Stale binaries = stale TLS fingerprint = fingerprintable.

### Building from source
- Full Chromium checkout via `tools/import-upstream.sh`
- Multi-hour build, ~100 GB disk for full Chromium tree
- **Don't self-build for the panel** — pull releases. Pin specific tag.

**Adapter implication:** expose "update binary" admin action; warn when pinned version is more than ~30 days behind upstream.

## Performance tuning

```bash
sysctl -w net.ipv4.tcp_congestion_control=bbr   # strongly recommended
sysctl -w net.ipv4.tcp_slow_start_after_idle=0
sysctl -w net.ipv4.tcp_notsent_lowat=131072     # H2 interactivity
# tcp_rmem/tcp_wmem sized to BDP — wiki example: 1 Gbps × 256 ms RTT = 67 MB
```

TCP Fast Open **discouraged** — Linux implementation conservative + distinctive on wire.

## Common deployment patterns

1. **Caddy + forwardproxy@naive** — canonical. Caddy serves real website on `:443`, forwardproxy plugin handles authenticated CONNECT, unauthenticated falls through to `file_server`. Probe-resistant.
2. **HAProxy + Caddy backend** — HAProxy on `:443` with SNI routing to Caddy on back port. Useful when 443 is shared.
3. **Naive standalone server** — `naive --listen=https://user:pass@0.0.0.0:443` with own TLS. **Loses real-frontend advantage. Not for production.**
4. **Naive as forward client only**, chained to non-Naive HTTPS proxy via `--proxy`.

## Limitations to plan around

- **No UDP relay.** TCP CONNECT only. (`quic://` transport is Naive's own client↔server tunnel, not UDP-tunneling.)
- **No native per-user accounting / kick.**
- **No native expiry / quotas / data caps.** Panel-side enforcement only.
- **No BBR knob in Naive itself** — kernel sysctl only.
- **Chromium-coupled release cadence** — stop updating ⇒ stale fingerprint.
- **First CONNECT cannot use TCP Fast Open** — padding capability not yet negotiated.
- **No SNI fronting / domain fronting.**
- **Browsers cap connections per proxy at 32** (`MaxConnectionsPerProxy=99` policy override possible).

## Subscription URL format (DuckSoft gist spec)

```
naive+<transport>://[user:pass@]host[:port][?queries][#fragment]
```

- **Transports:** `https`, `quic` → scheme is `naive+https` or `naive+quic`
- **Query params:**
  - `padding=true|false` (default false — set `true` for full Naive padding)
  - `extra-headers=<URL-encoded "Header:Value\r\nHeader:Value">`
- **Fragment:** human-readable label

Examples:
```
naive+https://alice:alicepass@example.com?padding=true#MyServer
naive+quic://manhole:114514@quic.test.me
naive+https://example.com?extra-headers=X-Username%3Auser%0D%0AX-Password%3Apassword
```

**For our subscription generator:** emit one `naive+https://...` per server inbound, `padding=true` always (we control both sides), user's basic-auth as user:pass. Multi-server = newline-joined.

## Caddyfile template — multi-user with probe resistance

```caddyfile
{
  order forward_proxy before file_server
}
:443, example.com {
  tls me@example.com
  forward_proxy {
    basic_auth alice alicepass
    basic_auth bob   bobpass
    basic_auth carol carolpass
    hide_ip
    hide_via
    probe_resistance
  }
  file_server {
    root /var/www/html
  }
}
```

This is what NaiveProxyAdapter must generate (with our user creds) and reload.

## Sources

- klzgrad/naiveproxy GitHub README, USAGE.txt
- klzgrad/forwardproxy@naive Caddy plugin
- Wiki: Performance Tuning, Run Caddy as a daemon, HAProxy Setup
- DuckSoft URI gist + GitHub issue #86
- Releases page (cadence/sizes)
- ArchWiki: NaïveProxy
- DeepWiki: NaiveProxy User Guide

## Refresh policy

- Re-fetch before slice 20 (NaiveProxyAdapter implementation)
- Specifically check: forwardproxy fork's basic_auth API, latest Caddy admin API endpoints, current Chromium pinning gap
- Watch for new multi-user features in upstream — would simplify adapter significantly
