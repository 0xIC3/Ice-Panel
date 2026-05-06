# Ice-Panel

🌍 **English** · [Русский](./README.ru.md)

Self-hosted proxy management panel with **native multi-core architecture**.

Where competitors (Marzban, Remnawave, x-ui) wrap everything through Xray-core, Ice-Panel runs the **real upstream binary** for each protocol — Hysteria2 server, Xray-core, AmneziaWG kernel module, NaiveProxy fork of Caddy — under a unified `CoreAdapter` abstraction.

## 🚀 One-command install

> Both scripts target Ubuntu 22.04+ / Debian 12+. Require root. Idempotent (safe to re-run). Validated end-to-end on real VPS for Xray (REALITY+Vision) and Hysteria 2 on 2026-05-06.

### 1. Panel — install on the admin's VPS

**Production with auto-TLS** (recommended) — point a DNS A-record like `panel.example.com` at the VPS (Cloudflare row → **DNS only / gray cloud**), wait for propagation, then:

```bash
sudo -i
PANEL_DOMAIN=panel.example.com \
  bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

The script installs Docker, builds the panel images, brings up Postgres + Redis + backend + frontend, **installs Caddy and configures auto-TLS** for your domain, locks `ufw` to 22/80/443 only, and prints the URL where you bootstrap the first admin. ~5–10 minutes on the first run.

**Bare-IP testing** (HTTP only — for quick local tests):

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

SPA goes up on `http://<vps-ip>:8080`. Don't run anything serious like this — admin JWTs travel in cleartext.

For Cloudflare Proxied mode (yellow cloud) with Origin Certificate — see [docs/deploy/reverse-proxy.md](./docs/deploy/reverse-proxy.md). **Cloudflare proxy is for the panel only** — proxy nodes must use DNS only, since CF Free doesn't pass UDP for Hysteria / AmneziaWG and breaks Xray+REALITY's fingerprint trick.

### 2. Node — one command per protocol

In the panel SPA: **Nodes → Create node** → fill `name` + `address` → submit. The modal reveals a copy-pastable **bootstrap command** with a single-use 15-min token. Paste on the node VPS, append the protocol-specific flags below.

#### Xray (VLESS + REALITY + Vision)

No domain needed — REALITY uses SNI spoofing. First create an Xray inbound in the panel (**Inbounds → Create**, click **Generate** for the keypair), then on the node VPS:

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol xray \
  --xray-reality-private-key sI_p9bg-7cy... \
  --xray-reality-short-ids   abc123 \
  --xray-reality-server-names www.cloudflare.com \
  --xray-reality-dest        www.cloudflare.com:443
```

#### Hysteria 2

Add a DNS A-record `hy2-01.example.com` → VPS IP (DNS only — UDP/443 doesn't go through CF Free anyway). Then:

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol hysteria \
  --hysteria-domain hy2-01.example.com \
  --hysteria-email admin@example.com
```

The script writes `/etc/hysteria/config.yaml` with ACME / masquerade / auth-callback, drops a `hysteria.service` systemd unit, and Hysteria's first run obtains the LE cert via HTTP-01 — no manual SSH editing.

#### AmneziaWG / NaiveProxy

```bash
bash <(curl -fsSL .../install-node.sh) --panel-url ... --bootstrap ... --protocol amneziawg
bash <(curl -fsSL .../install-node.sh) --panel-url ... --bootstrap ... --protocol naive
```

Both install the binaries (kernel module + tools for AWG; xcaddy fork for Naive — 2 GB RAM minimum) but currently require manual config-file editing post-install. Auto-config flags land in slice 24.

> ⚠️ **`node.address` is BOTH the mTLS endpoint AND the public host in client URIs** until slice 25. So set it correctly at create time: domain for Hysteria/Naive (`hy2-01.example.com:8443`), IP for Xray/AmneziaWG (`<ip>:8443`). Changing it later requires `Refresh bootstrap` (key icon on node row) to re-issue the cert with the matching SAN.

Full deploy guide (per-protocol details, troubleshooting, update workflow): **[docs/deploy/install.md](./docs/deploy/install.md)**.

---

## Status

🎉 **Phase 2 complete + multi-node multi-protocol VPS-validated** (2026-05-06). Two real VPS (Sweden Xray REALITY + Germany Hysteria 2) under one panel, one subscription URL emits both endpoints, Hiddify connects to both. Phase 3 in progress:

- ✅ **Slice 23.1** — panel-ops harden: node-status poller, `node.created` user backfill, Refresh-bootstrap UI button, install-node.sh per-protocol auto-config flags.
- ✅ **Slice 24a** — auto-push inbound config wire pipeline (panel→node mTLS), atomic `inbounds.json` persistence on the node side.
- ✅ **Slice 24b1** — `CoreAdapter.ApplyInbound` interface + Xray real impl (idempotent regen + restart). Hysteria/AWG/Naive stubbed.
- ✅ **Slice 25** — `publicHost` / `publicPort` separation on Inbound (closes the cert-SAN-mismatch gotcha at the architecture level).
- ⏭️ **Slice 24b2/3/4** next — Hysteria / AmneziaWG / Naive ApplyInbound real impls.
- ⏭️ **Slice 24c** — Xray defaults uplift + transports/subprotocols + per-user traffic stats.

Full plan: [docs/ROADMAP.md](./docs/ROADMAP.md) (v3, 2026-05-06).

See [docs/ROADMAP.md](./docs/ROADMAP.md) for the slice-by-slice progress plan and Phase 3 priorities.

## What's working

### Protocols
| Protocol | What runs on the node | Native or Xray-emulated |
|---|---|---|
| Hysteria2 | Real `hysteria server` (apernet/hysteria) with auth-callback + Brutal CC | native |
| Xray-core | Real `xray run` with VLESS + REALITY + Vision; transports: raw / xhttp / ws / gRPC | native |
| AmneziaWG | Real kernel module `amneziawg` + `awg syncconf` hot-reload (no restart on user mutation) | native |
| NaiveProxy | Real Caddy fork (`klzgrad/forwardproxy@naive` via xcaddy) | native |

### Subscription generator
- 6 wire formats: `plain` (base64 URI list), `json` (Ice-Panel structured), `clash` (Clash Meta YAML), `singbox` (Sing-box JSON), `wgconf` (wg-quick `.conf`), `xrayjson` (Xray client JSON)
- `?format=` query param explicit choice; otherwise auto-selected by **Subscription Response Rules** (regex on `User-Agent`) — 7 default rules cover Hiddify / Clash / NekoBox / sing-box / v2rayN / AmneziaVPN / `.*` fallback
- Stable per-user IP allocation for AmneziaWG (separate `amneziawg_peers` table)

### Admin UI
- **Users** — CRUD, traffic limits + reset strategies (no_reset / day / week / month / rolling), per-user `enabledProtocols` MultiSelect, soft-delete
- **Nodes** — CRUD with one-time mTLS payload modal at create
- **Inbounds** — per-protocol form (Hysteria / Xray REALITY / AmneziaWG with TSPU/Mobile/Custom obfuscation presets / Naive). x25519 keypair generator button — one click, no SSH to VPS
- **SRR** — UA-rule manager + "Test against UA" preview

### Operations
- One-command installers for both panel and node — see [docs/deploy/install.md](./docs/deploy/install.md)
- Production `docker-compose.prod.yml` with Postgres + Redis + backend + frontend
- 193 backend integration tests, 60+ Go tests, all green

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Panel (admin's VPS)                                        │
│                                                              │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│   │ panel-backend│   │  panel-      │   │  Postgres +  │    │
│   │  (Fastify TS)│   │  frontend    │   │  Redis       │    │
│   │              │   │  (React/Vite)│   │  (BullMQ)    │    │
│   └──────┬───────┘   └──────────────┘   └──────────────┘    │
└──────────┼──────────────────────────────────────────────────┘
           │ REST over mTLS (panel issues per-node certs)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Node (proxy VPS) — one per protocol recommended            │
│                                                              │
│   ┌──────────────┐                                          │
│   │ node-agent   │  spawn / signal /                        │
│   │ (Go static)  │ ─ syncconf / reload  ──┐                 │
│   └──────┬───────┘                        │                 │
│          │ HTTP auth-callback             ▼                 │
│          │ (Hysteria only)        ┌───────────────┐         │
│          └───────────────────────►│ hysteria  /   │         │
│                                   │ xray      /   │         │
│                                   │ amneziawg /   │         │
│                                   │ caddy-naive   │         │
│                                   └───────────────┘         │
│                                          │                   │
│                                          ▼ proxy traffic    │
│                                       Internet               │
└─────────────────────────────────────────────────────────────┘
```

The transport between panel and node is plain **REST over HTTPS with mutual TLS** — not gRPC. Panel acts as its own CA, issues per-node certificates encoded as a one-time base64 payload, the node-agent decodes it on first start.

### Repository layout

```
apps/
├── panel-backend/        Fastify API (TypeScript) — admin DB, business logic
│   └── src/
│       ├── modules/      one folder per domain (auth, users, nodes,
│       │                  inbounds, subscription, srr, amneziawg, ...)
│       └── core-adapters/  panel-side URI / config builders per protocol
├── panel-frontend/       Admin SPA (React 19 + Mantine 8 + TanStack Query)
└── node/                 Node-agent (Go 1.22+, single static binary)
    └── internal/core/
        ├── hysteria/     auth-callback + subprocess
        ├── xray/         config-restart pattern; gRPC AlterInbound deferred
        ├── amneziawg/    awg syncconf with systemctl restart fallback
        └── naive/        Caddyfile gen + caddy reload

packages/
└── shared/               Wire-format DTOs (TS source-of-truth; Go mirrors)

docs/
├── ROADMAP.md            Slice plan and tech-stack rationale
├── deploy/
│   ├── install.md        One-command install scripts (panel + node)
│   └── hysteria-node.md  Hysteria-specific deploy runbook (slice 13 era)
└── references/           Per-upstream protocol research notes

scripts/
├── install-panel.sh      Docker-based panel installer (one-liner)
└── install-node.sh       systemd-based node installer (one-liner per protocol)
```

## Tech stack

| Layer | Tools |
|---|---|
| Panel API | TypeScript, Fastify 5, Prisma 7, PostgreSQL 16, Zod, Pino |
| Background jobs | Redis 7, BullMQ, `node:events` event bus |
| Auth | JWT (jose), bcrypt, `@fastify/rate-limit` |
| Inter-service | REST + mutual TLS via `@peculiar/x509`, undici client |
| Frontend | React 19, Vite 8, Mantine 8, TanStack Query 5, Zustand 5 |
| Node-agent | Go 1.22+, native `crypto/tls`, `slog`, no gRPC |
| Tests | Vitest (panel), Go testing (node) |
| Infra | Docker, Docker Compose; one-shot install scripts |

## Develop

Requirements: Node 22+, pnpm 10+, Go 1.22+, Docker. Tested on Ubuntu (WSL).

```bash
# 1. Install JS deps
pnpm install

# 2. Start Postgres + Redis (dev compose)
docker compose up -d postgres redis postgres-test

# 3. Apply migrations to dev DB
pnpm --filter @ice-panel/panel-backend exec prisma migrate dev

# 4. Start backend (auto-reloads on save)
pnpm --filter @ice-panel/panel-backend dev

# 5. In a second terminal — start the SPA
pnpm --filter @ice-panel/panel-frontend dev

# 6. Open the SPA
open http://localhost:5173
```

The backend serves on `:3000`, the SPA on `:5173`, and the SPA proxies `/api`+`/sub` to the backend. Bootstrap the first admin via the SPA's "Create first admin" form.

### Tests

```bash
# Panel-backend integration tests (requires postgres-test on :5433)
pnpm --filter @ice-panel/panel-backend test

# Node-agent Go tests (no external services needed)
cd apps/node && go test ./...

# Frontend type-check
pnpm --filter @ice-panel/panel-frontend exec tsc --noEmit
```

## References

Internal protocol research compiled while building Ice-Panel — see [docs/references/](./docs/references/). Hysteria2, AmneziaWG, NaiveProxy, Xray-core operational references plus a deep-dive on Remnawave (architecture / modules / install UX) used as design oracle.

## License

[AGPL-3.0](./LICENSE) — copyleft, network use included. If you run a modified Ice-Panel as a service, you must offer the source to your users.
