# Ice-Panel security model

> Snapshot 2026-05-10. This doc is authoritative — when you change a security
> control in code, also update the table here. The `## Roadmap` section lists
> hardening work we have NOT yet shipped, with a rough effort estimate so it's
> easy to pick up between feature slices.

## Threat model

The panel is a control-plane for VPN nodes hosting state-actor-resistant
proxy protocols (Xray-REALITY, Hysteria 2, AmneziaWG, NaiveProxy, Shadowsocks-2022,
MTProto, Mieru). Adversaries we explicitly try to defeat:

| Adversary | Goal | Our posture |
|---|---|---|
| **Censor / DPI** (TSPU, GFW, Iran SHATEL) | Detect proxy traffic, fingerprint it | Protocol-layer (REALITY, AWG, Naive) — SOTA. Panel-side: `:443` anti-probe catch-all. |
| **Mass scanner** (zgrab, Shodan) | Inventory exposed services | mTLS port locked to panel IP (slice S7). Panel behind Cloudflare Proxied. |
| **Script kiddie** (login bruteforce, sub-token enumeration) | Get admin or steal a user's URL | Per-IP + per-username rate-limit (S7); 192-bit subscription tokens. |
| **Insider / stolen single-VPS** | Lateral-move to other nodes | Cert pinning (S6) — compromised node leaf can't impersonate panel to peers. |
| **Compromised panel host** | Full fleet RCE, read all traffic | Out of scope. Panel host is the root of trust. |
| **Supply-chain attack** (npm/Go module compromise) | RCE via dep update | Not in scope yet — see roadmap §13 (reproducible builds). |

## Controls we have shipped

### Authentication

| What | Where | Notes |
|---|---|---|
| bcrypt password hash, cost 12 | `admin.service.ts` | Admins only — panel users (subscribers) are token-only. |
| JWT HS256 + `JWT_SECRET` ≥32 chars | `app.ts`, `config.ts` | Token in HttpOnly+SameSite=Strict cookie + Bearer header. |
| API tokens prefixed `icp_*`, hashed at rest | `api-tokens` module | Currently full-admin scoped — see roadmap §B. |
| Per-IP rate-limit on `/api/auth/login` 5/min | `auth.routes.ts` | Standard Fastify rate-limit. |
| Per-username lockout (5 fails / 15 min → 15 min lock) | `auth.service.ts` (S7) | Cuts off distributed brute-force. Backed by Redis. |
| Subscription tokens — 256 bits, in URL path | `users.service.ts` | Token IS the credential, gated by HWID. |

### Panel ↔ Node (mTLS)

| What | Where | Notes |
|---|---|---|
| Per-node server cert (CA-signed) | `keygen.crypto.ts` | 1-year validity, reissued on `Refresh bootstrap`. |
| **Separate panel-client leaf** (clientAuth-only, signed by CA) | S6 | CA private key never participates in TLS handshakes. |
| **Cert fingerprint pinning on the agent** | `node/internal/server/server.go` (S6) | Agent's `VerifyPeerCertificate` rejects any leaf whose SHA-256 ≠ payload-pinned panel-client. Closes lateral-movement window. |
| Bootstrap tokens — `bs_*` 192-bit, single-use, 15-min TTL | `bootstrap.service.ts` | Token redeemed by agent → real payload over plain HTTP body (sidesteps 4 KB TTY paste limit). |
| Per-route rate-limit on bootstrap-redeem (10/min) | `nodes.routes.ts` (S7) | Defends against blind brute-force of `bs_*` candidates inside the 15-min TTL. |
| Heartbeat self-destruct via HMAC token (S6 / slice 38) | `heartbeat.routes.ts`, `node/internal/heartbeat` | Agent polls `/api/internal/nodes/me/status`; 3 consecutive 410s → exit code 42 → systemd does NOT restart. |
| Heartbeat rate-limit 120/min/IP | `heartbeat.routes.ts` (S7) | Caps DB load from bogus bearers. |

### Network

| What | Where | Notes |
|---|---|---|
| `TRUST_PROXY_HOPS` env (default 0) | `config.ts`, `app.ts` (S7) | Stops X-Forwarded-For spoofing in dev/single-host. Production behind Caddy + Cloudflare = `2`. |
| UFW lock-down on node-agent mTLS port to panel IP | `install-node.sh --panel-ip` (S7) | Without this, `:8443/tcp` was open to the world. |
| Caddy `:443 { tls internal }` catch-all | `docs/deploy/reverse-proxy.md` | Anti-probe — bare-IP HTTPS gets self-signed cert, no banner. |
| `:443` and protocol UDP open only as the protocol needs | `install-node.sh` | UFW deny-default. SSH + protocol port + mTLS port. |

### Subscription / sub-tokens

| What | Where | Notes |
|---|---|---|
| HWID enforcement (limit per user) | `hwid.service.ts` (slice S2) | Per-`(userId, hwid)` UNIQUE; sub-fetch with `x-hwid` outside whitelist → 403. |
| Subscription rate-limit 30/min keyed on `(ip, token)` | `subscription.routes.ts` (S7) | Caps token enumeration AND single-token bandwidth-flood. |

### AmneziaWG hooks (defence-in-depth)

| What | Where | Notes |
|---|---|---|
| `PostUp`/`PostDown` whitelist (iptables/ip/sysctl/echo only) | `node/internal/core/amneziawg/config.go` (S7) | These fields aren't on the panel→node wire — only set at install-time on the VPS. Whitelist is belt-and-braces against future regression. |

## Operational hygiene checklist (per VPS)

When provisioning a new panel or node, work through this list before exposing
the host. Marked `[auto]` is set by our installer; `[manual]` is on the operator.

- [auto] UFW deny-default + protocol-specific allows
- [auto] systemd `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`
- [auto] journald 50 MB cap (so a runaway log can't fill the disk)
- [auto] node-agent runs as `nobody` (no shell, no home dir)
- [manual] Disable root SSH password login: `PasswordAuthentication no` + key-only access
- [manual] `unattended-upgrades` for security patches: `apt install unattended-upgrades`
- [manual] **For panel host**: Cloudflare Proxied + UFW restricted to Cloudflare IP ranges (see `docs/deploy/reverse-proxy.md` option 3)
- [manual] **For node hosts**: pass `--panel-ip <IP>` to install-node.sh
- [manual] Set strong `JWT_SECRET` (≥32 chars from `openssl rand -base64 48`)
- [manual] Run `./scripts/ice-panel-backup.sh --password <strong>` after first admin login

## Roadmap — hardening we have NOT yet shipped

Listed in priority/impact order. Effort is rough engineer-days at our scale.

### Tier 1 — fits in a single sprint, real defence

1. ~~**Telegram / email webhook on critical events**~~ ✅ **partially shipped 2026-05-11.** Telegram bot push for `auth.login_ok` and `auth.lockout` via `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` env vars (no-op when either is unset). Fire-and-forget — flaky Telegram API can't break login flow. Still TODO: `admin.created`, `node.deleted`, `keygen_ca.rotated` events. *Lib: `apps/panel-backend/src/lib/telegram-notify.ts`.*
2. ~~**Geo-block panel by country**~~ ✅ **shipped 2026-05-11.** `ADMIN_ALLOWED_COUNTRIES` env (CSV ISO codes) checked against `CF-IPCountry`/`X-Country-Code` on `/api/*` only, skipping `/sub/*`, `/api/internal/*`, `/api/auth/status`, `/health`. Fail-closed when header missing on gated path. Empty list → disabled.
3. ~~**Honey routes**~~ ✅ **shipped 2026-05-11** (honey users still TODO). Hits to `/wp-admin`, `/.env`, `/xmlrpc.php`, `/.git/*`, `/phpmyadmin`, etc. → fake 404 HTML + IP into `sec:blacklist:<ip>` (Redis, `HONEYPOT_BLACKLIST_TTL_SEC` default 3600s). Subsequent requests from blacklisted IPs short-circuit at 403 before any business logic. Telegram alert on first-hit-of-IP. *Lib: `apps/panel-backend/src/lib/security-gate.ts`.*
4. **fail2ban integration** — drop a jail config for `/api/auth/login` 401s + `/sub/:token` 404s. Optional `--harden` flag in `install-panel.sh`. *~half day.*

### Tier 2 — meaningful but not urgent

5. **Audit-log hash chain** (append-only, each row hashes the previous). Detects post-hoc DB tampering. *~1 day.*
6. **REALITY active-probing detection** — parse Xray's access log for SteealOriginal hits, expose count metric, alert > N/hr. *~1.5 days, depends on Xray log format stability.*
7. **Per-region protocol presets** — auto-pick recipe defaults from admin's `CF-IPCountry` (TSPU → AWG; CN → REALITY+Vision; otherwise → Hysteria 2). UX win, not a hard control. *~1 day.*
8. **Hysteria port hopping in UI** — Hysteria 2 supports randomly rotating a UDP port range to defeat censor port-blocking; we don't expose it. *~1 day.*
9. **Adaptive IP-block on probing** — track failed mTLS handshakes / 4xx subscription fetches per source IP; auto-add to fail2ban-style cache. *~2 days.*

### Tier 3 — long-tail, only when scale demands

10. **API-token scopes** — current tokens are full-admin (intentional MVP). Add `scopes: ['users:read', 'nodes:write', ...]` + check at `requireAuth`. *~2 days. Prerequisite for shipping a customer-facing token UI.*
11. **CA at-rest encryption** — wrap CA private key with a key derived from `KEYGEN_KMS_SECRET` env. DB leak no longer = full fleet breach. *~1 day. Slight ergonomics cost (one more env to backup).*
12. **Reproducible Go agent build + signature self-check** — agent verifies its own binary at startup against a panel-published cosign sig. Defends against a tampered binary on a compromised VPS. *~3 days.*
13. **Anomaly detection** — flag user fetching from RU then 30s later from US; 5x daily traffic spike; new HWID without prior session. ML-light, just thresholds. *~2-3 days.*
14. **Backup encryption key escrow** — default backup uses AES-256 with operator-supplied password; consider Shamir-split key escrow for shared-admin setups. *~2 days.*
15. **Per-protocol probe-difference monitoring** — track latency/handshake-time outliers as early-warning of adversary mid-network manipulation. *~3 days, mostly infra.*

### Explicitly out of scope

- **Domain fronting via panel-controlled CDN.** Cloudflare's free tier doesn't support TCP/UDP passthrough at the protocol port; Spectrum is paid; nothing actionable.
- **Hardware Security Module (HSM) for CA key.** Overkill for self-hosted MVP. If you need HSM-tier custody you need a different product.
- **Multi-tenant isolation.** Ice-Panel is single-tenant by design (one admin org per install). Multi-tenant SaaS is a separate product.

## Reporting a vulnerability

If you find a security issue:

1. **Do NOT open a public GitHub issue.**
2. Email **security@icepath.tech** (or DM the maintainer on Telegram if no email response in 48h).
3. Include: reproduction steps, affected version (`git rev-parse HEAD`), impact assessment if known.
4. We aim to acknowledge within 48h and ship a fix within 7 days for critical findings.

We will credit reporters in the release notes unless you prefer anonymity.
