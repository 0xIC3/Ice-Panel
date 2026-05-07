---
name: MTProto proxy reference for Slice 41 MTProtoAdapter
description: Operational reference for MTProto proxy via 9seconds/mtg. Telegram-only protocol, Fake-TLS mandatory, secret-per-user model. Snapshot 2026-05-07.
type: reference
---
MTProto proxy = relay protocol Telegram clients use to bypass blocking. **Telegram-only — not a general-purpose VPN.** Repo we use: `9seconds/mtg`. License: MIT. Snapshot 2026-05-07. Refresh before slice 41.

## Architecture in one sentence

`Telegram client → MTProto-encrypted TCP (Fake-TLS framed) → mtg → Telegram DC servers`

The proxy doesn't decrypt user traffic — Telegram's MTProto end-to-end encryption stays intact between client and DC. mtg is a **frame relay** that authenticates the client by secret and forwards bytes. From mtg's perspective the user payload is opaque.

## Why "Telegram-only"?

- Protocol carries Telegram MTProto framing — no SOCKS/HTTP wrapping
- Client side is Telegram apps' built-in MTProto-proxy support; no third-party client needed
- One TG account → one TG session through the proxy. The proxy can't relay other apps' traffic.

This narrows the use case but **massively** simplifies the integration:
- No URI subscription generation in the client-config sense — TG clients consume a single `tg://proxy?...` link
- No per-app routing decisions
- No fingerprintable HTTP/TLS cover stack to maintain

## Why mtg specifically (vs official MTProxy)

Official `MTProxy` (Telegram's C reference): single-secret, single-instance, no Fake-TLS support out of the box (requires patches), no metrics endpoint, ~7-year-old C codebase.

`9seconds/mtg`:
- Go single binary, ~10 MB
- Fake-TLS mandatory and built-in (TG clients require it post-2020)
- **Multi-secret mode** (multi-user)
- `/stats` HTTP endpoint with per-secret counters
- Stable since 2019, maintained
- Replay-window protection, anti-DPI heuristics, blocklist support
- Production-tested at scale (Russian / Iranian Telegram users — millions of secret-redemptions per day)

## Fake-TLS — the key concept

Telegram's modern MTProto-proxy protocol wraps the encrypted MTProto frames inside what *looks* like a TLS handshake to a real domain. The client sends a ClientHello that names a real legitimate site (`www.cloudflare.com`, `www.google.com`, etc); DPI sees TLS-to-allowed-site and lets it through.

The proxy server has the matching server-side trick: when probed, it answers with a valid-looking ServerHello + cert from the masquerade domain, then transitions to relaying actual MTProto bytes once the client proves it knows the secret.

**Operational consequence:** mtg config requires a `secure` mode + a `domain` to masquerade as. Pick a domain that's:
- Reachable from your VPS (mtg actually proxies probes there as a fallback)
- Not blocked in the user's region (otherwise the cover blows)
- Plausibly something the user might actually visit (large CDN domains good)

Default we ship: `www.cloudflare.com`. Same target as our Xray REALITY default — admins can override.

## Secret format

Per-user secret is a **hex-encoded blob** with a leading byte that selects the proxy mode:
- `dd...` (32-char hex, leading byte `0xdd`) = legacy "secure" mode (deprecated in current TG; some old clients only)
- `ee...` followed by `<random_secret_hex><domain_hex>` = Fake-TLS mode (current)

For Fake-TLS:
```
ee<32-hex-bytes-secret><hex-encoded-domain>
```

Example, 32-byte secret + domain `www.cloudflare.com`:
```
ee0123456789abcdef0123456789abcdef777777772e636c6f7564666c6172652e636f6d
```

mtg generates these via `mtg generate-secret tls --hex <domain>`. We can do the same generation server-side in the panel (sha256 of `user.xrayUuid` truncated to 32 bytes, then hex-prepended `ee` + hex(domain)). Reusing UUID-derived secrets means no extra credential column in `users`.

## ⚠️ CORRECTION (2026-05-07): mtg is single-secret upstream

**Earlier draft of this doc was wrong.** It claimed mtg supports a `secrets = [...]` array for multi-user. It does not.

Verified against `9seconds/mtg/example.config.toml` and the upstream README, the author's documented stance is:

> "I think that multiple secrets solve no problems and just complex software."

One mtg instance = ONE secret. That's the entire user model upstream.

If you want multiple secrets, the upstream README points at the **`dolonet/mtg-multi`** fork — separate maintainer, lags upstream security fixes.

### Architecture our slice 41 actually ships

Single-secret-per-inbound. Every Ice-Panel user assigned to an inbound's squad receives the **same** URI:

```toml
secret = "ee0123abcd...777777772e636c6f7564666c6172652e636f6d"
bind-to = "0.0.0.0:443"
concurrency = 8192
prefer-ip = "prefer-ipv4"

[stats.prometheus]
enabled = true
bind-to = "127.0.0.1:3129"
metric-prefix = "mtg"
```

Note exact upstream key shapes:
- `secret` — singular, top-level, NOT `secrets = [...]`
- `prefer-ip` accepts `"prefer-ipv4"` / `"prefer-ipv6"` (NOT `"ipv4"`)
- Prometheus stats live in nested **`[stats.prometheus]`** table, NOT a flat `stats-bind-to` key
- Network timeout is nested **`[network.timeout]` { tcp, http, idle, handshake }**, NOT a flat `network-timeout` key

### Per-inbound secret derivation we use

```ts
secret = "ee" + sha256(inboundId + ":" + domain).hex + Buffer.from(domain).toString("hex")
```

Both panel and agent compute identical values. Domain change rotates the secret. Different inbound IDs yield different secrets, so admins running two MTProto inbounds (e.g. for two squads) get isolated secrets without any panel-side credential storage.

### Trade-offs of single-secret model

| Property | Effect |
|---|---|
| **Per-user accounting** | ❌ None upstream. mtg Prometheus emits global counters, not per-secret. Our adapter reports tracked userIDs as "online" with zero bytes. |
| **Force-kick one user** | ❌ Impossible. Removing a user from the panel just stops emitting their URI; if they cached the URL, they keep working until secret rotation. |
| **Domain change** | ✅ Rotates secret → invalidates every cached URI for this inbound. Effectively a force-kick-everyone. |
| **Per-user isolation** | Workaround: create N inbound rows for N user-buckets, each on a different port. Panel side handles the routing via squads. |
| **CLI subcommands** | `mtg run config.toml` (verified). `simple-run`, `generate-secret`, `doctor`, `access` also exist. |

## Subscription URI format

TG clients consume two equivalent forms:

**Form 1 — `tg://proxy?...` (deep-link):**
```
tg://proxy?server=proxy.example.com&port=443&secret=ee0123...777777772e636c6f7564666c6172652e636f6d
```

**Form 2 — `https://t.me/proxy?...` (web bouncer):**
```
https://t.me/proxy?server=proxy.example.com&port=443&secret=ee0123...777777772e636c6f7564666c6172652e636f6d
```

Both open the same dialog in the TG client: "Use this proxy?" Click → saved.

For our subscription generator: emit **both** forms; admins copy whichever opens cleanly on their device. The `https://t.me/proxy?...` form has the advantage that it works as a clickable link in any messenger / browser without the OS needing to register `tg://` scheme.

## Stats / per-user accounting

mtg exposes Prometheus-format metrics on its `stats-bind-to` address:

```
mtg_traffic_total{secret="<hash>",direction="rx"} 1024
mtg_traffic_total{secret="<hash>",direction="tx"} 4096
mtg_active_connections{secret="<hash>"} 3
```

`secret` label is a SHA256 hash of the secret (not the secret itself — privacy-preserving). To map back to user, the adapter keeps an in-memory `secretHash → userId` table populated when `AddUser` runs.

**GetStats implementation:** scrape Prometheus endpoint, parse, lookup userId by secret-hash, return `core.UserStats[]`. Soft-fail on scrape failure.

## Server config we'd render

`/etc/mtg/config.toml` (mtg uses TOML, not YAML):

```toml
secret = ""    # legacy single-secret; we use multi-secrets mode below

# Multi-secret mode — each line is one user
secrets = [
    "ee01...domain-hex",
    "ee02...domain-hex"
]

bind-to = "0.0.0.0:443"

stats-bind-to = "127.0.0.1:3129"   # Prometheus metrics — loopback only
network-timeout = "10s"

allowed-ip-ranges = []     # empty = allow all; could lock to user CIDRs
blocked-ip-ranges = []     # for spam containment

prefer-ip = "ipv4"
buffer-size = "16Kb"
```

Simpler than xray. No subprocess management beyond `mtg run config.toml` and `kill -HUP <pid>` for reload.

## Operational gotchas

1. **Port 443 is best.** TG clients try 443 first heuristically; other ports work but trigger more "checking proxy..." UX in the client. Most VPS setups can't run mtg + Hysteria + Xray all on 443 — pick one. For single-protocol-per-node deployments (recommended), put MTProto on its own VPS.

2. **Multi-secret mode replaced single-secret.** `secret = "..."` (single) is legacy; new deployments use `secrets = [...]` (list). Old TG client builds may not handle lists correctly — verify against current mtg release.

3. **Domain hex encoding gotcha.** The trailing portion of the secret (after the 32-byte secret) is `bytes(domain).hex()`. Lowercase, no separators. `www.cloudflare.com` → `7777772e636c6f7564666c6172652e636f6d`. Off-by-one bug-magnet — write tests for the encoder.

4. **Blocked TG datacenters.** Some networks selectively block Telegram DC IPs. mtg can't route around this — it's a relay, the DC connection still leaves your VPS to TG's IPs. If the VPS-to-TG path is blocked, mtg can't help.

5. **No HTTP fallback.** If TG client can't reach the proxy (whatever the reason — DNS, port, DPI), it falls back to no-proxy. From the user's perspective: messages stop arriving. The proxy admin sees no "user disconnected" event.

6. **Replay protection bites mobile users.** mtg's replay-window default is 60s. Mobile users on flaky connections see "proxy connection unstable" warnings frequently. Bumping window to 120s helps; cost is slightly weaker replay defence.

7. **Single point of failure for the user.** Unlike VLESS/SS where a user can have N inbounds in their subscription and clients balance, TG clients accept ONE proxy at a time. If that one proxy is down, user has no Telegram. Recommend: run two MTProto nodes, give users both, document "switch in TG settings if first stops working."

## What we'd ship in slice 41 v1

- `bootstrap-mtg.sh`: download from `9seconds/mtg/releases`, install to `/usr/local/bin/mtg`, drop systemd unit
- node-agent `MTProtoAdapter`:
  - Manages `secrets:` list in TOML config
  - AddUser → derive `ee<sha256(uuid)[:32].hex><domain.hex>` → append to list → SIGHUP
  - RemoveUser → drop entry → SIGHUP
  - GetStats → scrape `127.0.0.1:3129` Prometheus, parse, lookup secrets → users
  - ApplyInbound → swap `domain` → regenerate ALL secrets (domain in suffix) → SIGHUP. **Domain change rotates every user's secret** — UI must warn admin "all users will need a fresh URL."
- panel-side wire: `MTProtoInboundCfg { domain: string }`
- subscription endpoint: emit `tg://proxy?...` + `https://t.me/proxy?...` pair
- frontend: form section with Domain TextInput + Cloudflare default + warning "domain change rotates all users' secrets"

Estimate: 2-3 days solo. Less than Mieru because no bytes-per-frame protocol nuance — mtg owns all that complexity.

## What we'd NOT ship

- Custom secret format (`dd...` legacy / non-Fake-TLS) — Fake-TLS is mandatory in current TG
- Anti-replay tuning UI — just hardcode a sane `network-timeout: 10s`
- Per-user IP allow-listing — unusual feature, request-driven
- Custom mtg builds — pull releases, pin version

## Refresh policy

Re-read mtg upstream README before slice 41. Watch for:
- Config TOML schema changes (multi-secret syntax has churned)
- New mtg subcommands (`generate-secret` flags, `replace-secret`)
- Telegram protocol changes (clients periodically tighten what proxies they accept; mtg ships compat updates)
- TG datacenter IP changes (mtg has them baked in; old binaries see "DC unreachable")
