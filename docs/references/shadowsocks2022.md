---
name: Shadowsocks 2022 reference for Slice 24d ShadowsocksAdapter
description: Operational reference for SS2022 server-side via xray-core. Per-user multi-tenant config, cipher landscape, SIP002 URI, client compat. Snapshot 2026-05-07.
type: reference
---
Shadowsocks 2022 = modern revision of the AEAD-encrypted SOCKS-like proxy. Snapshot 2026-05-07 from xray-core docs + shadowsocks.org. Refresh before slice 24d ships to a real VPS.

## Architecture in one sentence

`Client → SOCKS5-style request → SS2022-AEAD-encrypted TCP/UDP → SS server → upstream`

No TLS. No HTTP. Just AEAD-encrypted framed TCP (and optional UDP relay). The encryption itself is the disguise — random-looking ciphertext.

## SS2022 vs legacy SS (the schism that matters)

Two **incompatible** protocol versions coexist:

### Legacy SS (AEAD-2018)
Ciphers: `chacha20-ietf-poly1305`, `aes-256-gcm`, `aes-128-gcm`. Client and server share a password; the password is HKDF'd into the AEAD key.

**Why it's still around:** every SS client back to ~2018 supports it. Outline, Shadowrocket, ss-android, NekoBox.

**Why it's dying:** 2022 academic work demonstrated active probing detection — chosen-plaintext attacks distinguish SS streams from random TCP. Iran, Russia, China DPI all detect legacy SS reliably now.

### SS2022 (AEAD-2022 family)
Ciphers: `2022-blake3-aes-128-gcm`, `2022-blake3-aes-256-gcm`, `2022-blake3-chacha20-poly1305`. Different key-derivation (BLAKE3 instead of HKDF-SHA1), different framing, anti-replay sequence numbers, **forward-secure session keys** derived per-connection.

**Why pick this:** active probing resistant. Detection requires storing every recent-stream nonce — operationally expensive for DPI vendors.

**Compat:** Xray ≥ v1.8, sing-box ≥ v1.0, shadowsocks-rust ≥ v1.15, sing-box-android, Shadowrocket ≥ v2.2.5, Hiddify, NekoBox.

**Default we ship:** `2022-blake3-aes-256-gcm`. Best client coverage in the SS2022 family; AES-NI-accelerated on every modern CPU.

## Multi-user via xray-core (what we use)

xray-core's `shadowsocks` inbound supports per-user keys natively from v1.8:

```json
{
  "protocol": "shadowsocks",
  "settings": {
    "method": "2022-blake3-aes-256-gcm",
    "clients": [
      { "password": "<base64-32-bytes>", "email": "user-uuid-1" },
      { "password": "<base64-32-bytes>", "email": "user-uuid-2" }
    ],
    "network": "tcp,udp"
  }
}
```

Per-user `password` is the user's PSK. For SS2022 ciphers it must be **exactly the right length**:
- `2022-blake3-aes-128-gcm`: 16 bytes (base64 → 24 chars)
- `2022-blake3-aes-256-gcm`: 32 bytes (base64 → 44 chars)
- `2022-blake3-chacha20-poly1305`: 32 bytes

**Our shortcut (slice 24d):** we use `user.xrayUuid` (a 36-char UUID string) directly as the per-user password. The string contains 36 ASCII bytes which xray's PSK derivation hashes down to the right length internally. **This is non-canonical** — the spec wants raw key bytes base64-encoded. xray-core tolerates string passwords by hashing, but other SS2022 servers (sing-box, ss-rust) may not. Document for users: "the panel-issued URL works only with xray-core SS2022 implementations" if we hit interop issues.

**Cleaner alternative for v2:** generate a real 32-byte PSK per user, store base64 in `users.shadowsocksPassword`. Add when there's actual demand. Today's UUID-as-password works in xray and in clients that hit xray.

## ⚠️ CORRECTION (2026-05-07): Server PSK was missing

Earlier draft of slice 24d shipped without a server-level PSK at the
`settings.password` slot. Verified against
`XTLS/Xray-examples/Shadowsocks-2022/README.ENG.md`: xray-core SS2022
multi-user mode requires:

- `settings.method` — cipher
- `settings.password` — **server PSK** (auto-generated 32-byte base64 in our flow)
- `settings.clients[i].password` — **per-user PSK**
- `settings.network` — `"tcp,udp"` for full SS2022 features

**Client URI** colon-joins both: `base64url(method:ServerPSK:UserPSK)`.
That's enforced now in `buildShadowsocksUri` — pass `serverPsk` for
SS2022, omit for legacy AEAD single-tenant.

The earlier code emitted only `base64url(method:UserPSK)` — single-
tenant format that breaks in xray-core SS2022 multi-user (server
expects a colon-prefix and rejects the user's auth otherwise).

Anti-regression: `inbounds.service.ts createInbound` auto-generates a
correct-length server PSK when admin doesn't supply one (16 bytes for
`2022-blake3-aes-128-gcm`, 32 bytes for the others — base64-encoded
via `crypto.randomBytes`).

## URI format (SIP002)

```
ss://<base64url(method:password)>@<host>:<port>#<fragment>
```

- `base64url` = base64 with `-` and `_` instead of `+` and `/`, and **no `=` padding**
- `fragment` is URL-encoded display name (`#node-1` or `#node%201%20EU`)
- For SS2022, `password` is the per-user PSK string we ship; client decodes the b64url, splits on `:`, hands `(method, password)` to its SS engine

Older SIP002 used base64-standard but every modern client we care about (Outline, Shadowrocket, NekoBox, Hiddify, sing-box) accepts base64url. Several reject `+/=` in the userinfo segment — base64url is the safe default.

**Plugin params (we don't use):** SIP003 plugins (`v2ray-plugin`, `shadow-tls`, `cloak`) can be appended via `?plugin=...&plugin-opts=...`. Adds layered transport. Not needed for SS2022 — its native crypto is the obfuscation.

## Stats / per-user accounting

xray's StatsService picks up SS users automatically because we set the `email` field on each client. Same `xray api statsquery -reset -pattern user` mechanism as VLESS/Trojan (slice 24c part 1).

The SS adapter on the node shells out to its **own** api inbound on `127.0.0.1:8081` (one above the VLESS adapter's `:8080` so they don't conflict if both run on the same node).

## Server config we render (slice 24d)

`/etc/xray/shadowsocks.json` contains:
- `stats: {}` + `policy.levels.0.statsUserUplink/Downlink: true` + system stats
- `api` (`tag: "api"`, services: StatsService + HandlerService)
- One inbound `protocol: shadowsocks` (our user-facing SS server)
- One inbound `tag: "api-in"` (`dokodemo-door` on 127.0.0.1:8081, gRPC management)
- Outbounds: `direct` (sockopt-BBR + tcpFastOpen), `dns-out`, `blackhole`
- Routing rules: api-in → api, dns → dns-out, bittorrent → blocked, port:25 → blocked
- `network: "tcp,udp"` — SS2022 supports UDP relay (DNS, QUIC, real-time UDP apps)

## UDP relay — gotcha

SS2022 does support UDP relay over the same port. Clients send `\x03 <addr> <data>` framed in AEAD; server proxies UDP to upstream. **Caveats:**
- Stateful — each UDP "session" has TTL (~60s default in xray)
- **NAT traversal**: server's outbound UDP socket pool must have public address; if VPS is behind NAT, UDP relay silently fails
- Disable when not needed: `network: "tcp"` only

For our default we keep `tcp,udp` — most VPS providers give clean public IPs and the UDP feature is exactly what some users want for low-latency apps.

## Client compat matrix (as of mid-2026)

| Client | SS2022 | base64url URI | UDP relay |
|---|---|---|---|
| **Outline** (iOS/Android/macOS) | ✅ | ✅ | ✅ |
| **Shadowrocket** (iOS) | ✅ | ✅ | ✅ |
| **sing-box** (cross-platform) | ✅ | ✅ | ✅ |
| **NekoBox** (Android/Win) | ✅ | ✅ | ✅ |
| **Hiddify-Next** | ✅ | ✅ | ✅ |
| **Streisand** (iOS) | ✅ (>v1.6) | ✅ | ⚠️ buggy in some builds |
| **shadowsocks-android** legacy | ❌ legacy only | ✅ | ✅ |
| **clash classic** | ❌ legacy only | ✅ | ✅ |
| **clash.meta / mihomo** | ✅ | ✅ | ✅ |

**Recommendation in admin UI:** "Use Hiddify-Next or sing-box for guaranteed SS2022 compatibility. Stay on legacy AEAD only if you have users on old clients you can't upgrade."

## Operational gotchas

1. **Cipher mismatch is silent.** Server SS2022, client legacy → connection drops with no readable error in either log. Always advertise the method in the URI; clients that don't read URI method will fail.

2. **Replay window is per-client-IP.** SS2022 server keeps a sliding nonce window; if a client roams between cellular and Wi-Fi mid-session, some packets may be replay-rejected briefly.

3. **No keep-alive.** Long-idle TCP connections die at the OS TCP keepalive timeout (typically 2h). For long-running tunnels, the client should send periodic noise.

4. **DNS leak risk.** Clients that don't ship DNS through the SS tunnel will leak. Modern clients (Hiddify, NekoBox) do tunnel DNS by default; older ones don't. Not our problem to fix at the server level — `dns-out` outbound only protects DNS that *does* arrive at our SS server.

5. **xray version pinning.** SS2022 in xray-core has had silent breaking changes on minor versions (v1.8 → v1.8.4 changed the BLAKE3 key derivation salt; old clients didn't notice but new clients failed mysteriously against old servers). Pin xray version in `bootstrap-xray.sh`; document the minimum SS2022-supporting version in node README.

6. **Port reuse.** SS2022 on `:443/TCP` works behind almost every firewall (most networks let TLS-on-443 through), but visually fingerprintable as "TCP traffic that isn't TLS" — DPI may flag it. For DPI-hostile environments, layer SIP003 plugin (`shadow-tls`) on top. Not in our roadmap today; admins can run it manually via `--plugin` on the binary.

## What we did NOT implement (intentional)

- **Per-user `users.shadowsocksPassword` column** — UUID reuse is good enough for v1
- **Single-password mode** (legacy SS server-wide secret) — irrelevant for multi-tenant panel
- **SIP003 plugins** (shadow-tls / v2ray-plugin / cloak) — out of scope for slice 24d; layer manually if needed
- **clash classic compat** — Mihomo / clash.meta covers the modern crowd

## Refresh policy

Re-fetch from xray-core release notes monthly. Watch for:
- New SS2022 ciphers (post-quantum being discussed but not shipped)
- BLAKE3 derivation salt changes (have happened before)
- UDP relay protocol tweaks
- Replay window default changes
