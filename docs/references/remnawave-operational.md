---
name: docs.rw — Remnawave operational/UX reference
description: How Remnawave teaches users to install, configure, deploy. Complements code analysis. Snapshot 2026-05-04.
type: reference
originSessionId: 652e2420-3ff6-4298-a3e6-48489cb0137f
---
UX/operational view of Remnawave from `docs.rw`. Snapshot 2026-05-04. Use when designing Ice-Panel UX/install — see what UX problems Remnawave has and what works.

## Architecture model (as taught to users)

4 components, install in this order:
1. **Panel** (control plane)
2. **Reverse proxy** (mandatory — see below)
3. **Subscription page** (optional but recommended; separate service)
4. **Node** (data plane; same-server install "not recommended")

**Mental model:**
- Panel doesn't include Xray-core. It pushes config to nodes via `NODE_PORT`.
- **Config Profile** = full Xray-core JSON template, reusable across nodes.
- **Inbound** = entry inside a Config Profile.
- **Host** = user-facing connection record consumed by client apps. One inbound per host.
- **Internal Squad** = ACL group: which inbounds a user can use.
- **External Squad** (v2.2.0+) = subscription-format override per group (NOT a network ACL — naming is misleading).
- **User → ≥1 Internal Squad → inbounds across Config Profiles**.

## Auth between panel and node = SHARED SECRET, NOT mTLS

`SECRET_KEY` env var on node + matching `NODE_PORT` (firewalled to panel IP only). For Xray's TLS inbounds, certs mounted into container at `/var/lib/remnawave/configs/xray/ssl/`.

**Ice-Panel differentiator:** real mTLS via `@peculiar/x509` (slice 9). Genuinely stronger than Remnawave.

## Reset strategies (post-1.3.1)

ONLY 4 values now (CALENDAR_MONTH and YEAR removed):
- `NO_RESET` — never resets
- `DAY` — every day at 00:00 UTC
- `WEEK` — Mondays 00:00 UTC
- `MONTH` — 1st of month 00:00 UTC

Migration is irreversible. **Ice-Panel data model already aligned with these 4 values** (slice 3 schema decision).

## Subscription template families

NOT one per client — clients map to a family:
1. **Mihomo** — Clash successor (proprietary Remnawave keys supported)
2. **Xray-json** — for Xray-core clients
3. **Sing-box** — for sing-box clients
4. **Base64** — fallback: `\n`-separated server configs, base64-encoded

Multiple templates per family allowed via External Squads or Response Rules. **Ice-Panel slice 12 must support at minimum Base64 (universal) + JSON (our own clients).**

## Reverse proxies (4 supported)

| | Auto-SSL | Notes |
|---|---|---|
| **Caddy** | yes (built-in) | Doc default, simplest |
| **Traefik** | yes (Let's Encrypt) | File-provider model, **user has experience with this** |
| **Angie** | yes | Russian fork of Nginx |
| **Nginx** | manual via **acme.sh, NOT certbot** | Most flexible |

**TryCloudflare** for dev only. SSH port forwarding **explicitly unsupported**.

### Caddy default config (verbatim from docs)
```caddy
https://REPLACE_WITH_YOUR_DOMAIN {
    reverse_proxy * http://remnawave:3000
}

:443 {
    tls internal
    respond 204
}
```

The `:443` block returns `204 No Content` for any TLS request without matching SNI — defeats domain scanners cheaply.

## Critical operational warnings (loud and repeated)

1. **Reverse proxy is required.** Bind only to `127.0.0.1`.
2. **No sub-path serving** — must be at domain or subdomain root.
3. **NODE_PORT firewall:** restrict to panel IP only.
4. **Node logs:** "you must set up log rotation, otherwise the logs will fill up your disk."
5. **Inbounds gotcha:** setting up node + host is NOT enough. Must enable inbounds in **Internal Squad**. (Biggest UX trap — users complain repeatedly.)
6. **Reset strategy migration is one-way** — can't downgrade after 1.3.1.
7. **Geoip/geosite mounting:** mount each FILE individually, NOT the whole `/usr/local/share/xray/` directory.

## Self-acknowledged gaps in Remnawave (from comparison page)

- **No multi-admin support**
- **No native VMESS hosts**
- **No native WireGuard**

These are **direct opportunities for Ice-Panel positioning**.

## What Ice-Panel can do better (gleaned from docs)

1. **Collapse the Inbound-Squad-Host triangle UX trap** — single "Publish inbound" action that wires all three. Their #1 user complaint.
2. **Real mTLS panel↔node** instead of shared secret + IP firewall.
3. **First-party backup tool** — Remnawave has zero, only community Backuper script.
4. **Multi-admin** with proper RBAC.
5. **Native WireGuard/AmneziaWG support** (their explicit gap).
6. **In-panel diagnostics page** for node health — Remnawave forces docker logs / webhook events for diagnosis.
7. **Per-protocol UI** instead of "raw Xray JSON editor + snippets". Our `CoreAdapter` enables this.
8. **Cleaner naming** — "External Squad" is confusing; we'd call it "Subscription Profile" or similar.

## What to copy verbatim

1. **"Copy docker-compose.yml" button** at node creation with pre-filled SECRET_KEY — excellent UX touch.
2. **Subscription page as separate service** — privacy/operational split. Hide panel domain from end users.
3. **Webhook scopes** as event taxonomy: `user`, `user_hwid_devices`, `node`, `service`, `crm`, `torrent_blocker`, `errors`. Webhook events richly cover lifecycle: traffic-reset, expiration warnings at 72/48/24h, first_connected, bandwidth thresholds, not_connected.
4. **Migration tool architecture** — `remnawave-migrate` CLI as precompiled binary that reads competitor's DB and writes to ours. Plan equivalent for Marzban→Ice-Panel migration.
5. **Subscription URL pattern** `https://subdomain.panel.com/<shortUuid>` (16-64 char short ID).
6. **Host with optional override fields** — SNI/ALPN/path/fingerprint inherit from inbound unless overridden. Reduces UI noise.
7. **Bulk actions** on user list (gear icon): activate/deactivate, set unified data limit + reset, extend duration. Filter-driven multi-select.
8. **Per-user "Show usage" / "HWIDs" / "Subscription QR" / "Request History"** menu actions — comprehensive admin observability.

## Notable per-feature details

### Hosts (`Hosts → + Create new host`)
Modal fields:
- **Host visibility** toggle (subscription appears or not)
- **Remark** — display name in client (e.g. `"Finland"`)
- **Inbound selection** — pick from Config Profile inbounds. **Constraint: one inbound per host.**
- **Address** — IP or domain (docs prefer domain for DNS-update flexibility)
- **Port** — auto-populated from inbound

Advanced overrides: SNI overrides inbound's `serverNames`; if empty, falls back to inbound config.

### Nodes
**Consumption multiplier:** "1.0 means normal, 0.5 counts half traffic, 2.0 doubles." For premium-cost regions.

**Tracking & Billing:** Infrastructure Provider tag, monthly traffic-limit watcher with reset day, threshold alert "9 TB of traffic has been used".

### Telegram
**Two separate features:**
1. **OAuth admin login** — bot token + admin chat IDs in panel + `@BotFather` domain set
2. **Notifications** — env-driven: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_NOTIFY_USERS`, `TELEGRAM_NOTIFY_NODES`, `TELEGRAM_NOTIFY_CRM`, etc. Custom Bot API root supported (`TELEGRAM_BOT_API_ROOT`), proxy supported.

**Bot does NOT manage users.** Community bots (RWP Shop, Bedolaga, Remnashop) handle user-facing sales separately.

### Webhooks
Env-driven config: `WEBHOOK_ENABLED`, `WEBHOOK_URL` (comma-separated), `WEBHOOK_SECRET_HEADER` (≥32 chars).

Payload:
```json
{
  "scope": "service",
  "event": "service.panel_started",
  "timestamp": "2026-01-07T11:57:29.426Z",
  "data": { ... }
}
```

Headers: `X-Remnawave-Signature` (HMAC-SHA256), `X-Remnawave-Timestamp`.

### Migration from Marzban
Tool: `remnawave-migrate` precompiled binary. Reads Marzban DB via API + JWT secret. Preserves legacy subscription URLs via `MARZBAN_LEGACY_LINK_ENABLED=true` + `MARZBAN_LEGACY_SECRET_KEY` on subscription-page service — old links keep working.

3X-UI / S-UI migration is community-script territory.

## Subscription page (separate service)

Compose:
```yaml
services:
  remnawave-subscription-page:
    image: remnawave/subscription-page:latest
    ports:
      - '127.0.0.1:3010:3010'
```

Env: `APP_PORT`, `REMNAWAVE_PANEL_URL`, `REMNAWAVE_API_TOKEN`, `CUSTOM_SUB_PREFIX`.

The subscription page is a **frontend that consumes the panel's API** — hides the panel domain from end users. Two install modes: bundled (same server) or separate (recommended for production).

## Node install workflow

```bash
sudo curl -fsSL https://get.docker.com | sh
mkdir /opt/remnanode && cd /opt/remnanode
nano docker-compose.yml
docker compose up -d && docker compose logs -f -t
```

Compose:
```yaml
services:
  remnanode:
    image: remnawave/node:latest
    network_mode: host
    environment:
      - NODE_PORT=2222
      - SECRET_KEY="supersecretkey"
```

## Panel install workflow

```bash
sudo curl -fsSL https://get.docker.com | sh
mkdir /opt/remnawave && cd /opt/remnawave
curl -o docker-compose.yml https://raw.githubusercontent.com/remnawave/backend/refs/heads/main/docker-compose-prod.yml
curl -o .env https://raw.githubusercontent.com/remnawave/backend/refs/heads/main/.env.sample
```

Then sed pipeline for secrets:
```bash
sed -i "s/^JWT_AUTH_SECRET=.*/JWT_AUTH_SECRET=$(openssl rand -hex 64)/" .env
sed -i "s/^JWT_API_TOKENS_SECRET=.*/JWT_API_TOKENS_SECRET=$(openssl rand -hex 64)/" .env
sed -i "s/^METRICS_PASS=.*/METRICS_PASS=$(openssl rand -hex 64)/" .env
pw=$(openssl rand -hex 24) && sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$pw/" .env
```

Manual: `FRONT_END_DOMAIN`, `SUB_PUBLIC_DOMAIN`. Services bind to `127.0.0.1` only.

**Ports:** 3000 (panel), 3001 (metrics, basic auth via `METRICS_USER`/`METRICS_PASS`).

## Refresh policy

- Re-fetch before slice 14 (Frontend) — to verify their UX patterns we're imitating
- Re-fetch before slice 15 (Docker prod) — to mirror their docker-compose layouts
- Re-fetch when migrating from Marzban — to align with their migration tool format
