# Ice-Panel

🌍 **English** · [Русский](./README.ru.md)

Self-hosted proxy management panel with **native multi-core architecture**.

Where competitors (Marzban, Remnawave, x-ui) wrap everything through Xray-core, Ice-Panel runs the **real upstream binary** for each protocol — Hysteria2 server, Xray-core, AmneziaWG kernel module, NaiveProxy fork of Caddy — under a unified `CoreAdapter` abstraction.

## 🚀 One-command install

> Both scripts target Ubuntu 22.04+ / Debian 12+. Require root. Idempotent (safe to re-run).

### Panel — install on the admin's VPS

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

Builds the Docker images locally, generates random secrets, runs the
Postgres + Redis + backend + frontend stack, and prints the URL where you
bootstrap the first admin. Takes ~5–10 minutes on the first run.

### Node — install on each proxy VPS

In the panel UI: **Nodes → Create node** → copy the one-time base64 payload from the modal. Then on the VPS — run the installer **with no flags** for an interactive menu:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh)
```

The script will prompt:

```
Pick a protocol for this node:

  1) Xray         VLESS+REALITY+Vision (TCP/443, transports raw/xhttp/ws/grpc)
  2) Hysteria 2   UDP/443, QUIC, Brutal CC — best throughput on lossy links
  3) AmneziaWG    DPI-resistant WireGuard fork (needs kernel module)
  4) NaiveProxy   Caddy fork with klzgrad/forwardproxy@naive (≥2 GB RAM)

Select [1-4]:
```

…then ask for the base64 payload, and proceed end-to-end.

**Or pass the choice as flags** (useful for automation / re-runs):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --protocol xray \
  --payload "<base64-blob-from-panel>"
```

Valid `--protocol` values: `xray`, `hysteria`, `amneziawg`, `naive`.

The installer chains the protocol's official bootstrap (`get.hy2.sh`,
XTLS install-script, AmneziaWG PPA + kernel-module probe, xcaddy build for
Naive), drops a `systemd` unit, opens `ufw` ports, and waits until `/healthz`
answers.

Full deploy guide (troubleshooting / TLS-fronting / update workflow / why
single-protocol-per-node): **[docs/deploy/install.md](./docs/deploy/install.md)**.

---

## Status

🎉 **Phase 2 complete** (2026-05-05). MVP ready for self-hosted VPS testing. All four protocol adapters built and end-to-end through the admin UI; subscription generator supports six formats with UA-driven auto-selection; full inbound + SRR editor.

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
