# Ice-Panel

Self-hosted proxy management panel with **native multi-core support**.

## Status

🚧 **Early development.** Phase 1 (MVP with Hysteria2) in progress — see [docs/ROADMAP.md](./docs/ROADMAP.md) for the full 15-slice plan and progress.

### What's working now

- Fastify HTTP server with structured logging (Pino) and `/health` endpoint that pings PostgreSQL
- Zod-validated environment configuration (fails fast on missing/invalid values)
- PostgreSQL 16 + Prisma 7 with **14 tables** covering admins, users, nodes, inbounds, groups (squads), traffic, audit log, and history — full schema designed for multi-core from day one
- REST CRUD on `/api/users` with Zod input validation, soft-delete, pagination, and search
- Auto-generated credentials for **all four protocols** (Hysteria2 password, AmneziaWG X25519 keypair, NaiveProxy password, Xray UUID) at user creation
- JWT authentication (bcrypt cost 12) with bootstrap-only `/register`, rate-limited `/login` (5/min), and `requireAuth` hook protecting `/api/users/*`
- Layered architecture (routes → service → repository) with typed domain event bus
- AGPL-3.0 license; private repo for now

Not ready for production use.

## What makes it different

Most proxy panels (Marzban, Remnawave, x-ui) wrap everything through Xray-core. Ice-Panel uses **native protocol implementations** — running real upstream binaries for each protocol:

- **Hysteria2** — real Hysteria2 server with Brutal congestion control and salamander obfuscation
- **AmneziaWG** — DPI-resistant WireGuard fork
- **NaiveProxy** — HTTP/2 over Chromium network stack
- **Xray-core** — for VLESS/Reality/VMess/Trojan (legacy support)

The architectural bet is the `CoreAdapter` interface — adding a new core means implementing one interface, no other changes.

## Architecture

Monorepo (pnpm workspaces) with three services:

- **Panel backend** — API, admin database, business logic
- **Node agent** — runs on each VPS, manages proxy core processes
- **Frontend** — admin SPA

Communication: REST over HTTPS with mutual TLS between panel and nodes (no gRPC). Background jobs and scheduled tasks via Redis + BullMQ.

```
apps/
├── panel-backend/   API panel (TypeScript/Fastify)
├── panel-frontend/  Admin UI (React/Vite/Mantine)
├── node/            Node agent (Go, single static binary)
└── subscription/    Subscription URL generator

packages/
├── shared/          Shared TypeScript types & API contracts
└── core-adapters/   One adapter per proxy core (Hysteria, AmneziaWG, Naive, Xray)
```

## Tech Stack

| Layer | Tools |
|---|---|
| Backend | TypeScript, Fastify, Prisma, PostgreSQL, Zod, Pino |
| Background jobs | Redis, BullMQ, `node:events` event bus |
| Auth | JWT (jose), bcrypt, @fastify/rate-limit |
| Inter-service | REST over HTTPS with mutual TLS (`@peculiar/x509`) |
| Frontend | React 19, Vite, Mantine 8, TanStack Query, Zustand |
| Node agent | Go 1.22+, native `crypto/tls` |
| Tests | Vitest |
| Infra | Docker, Docker Compose |

See [docs/ROADMAP.md](./docs/ROADMAP.md) for detailed rationale and slice-by-slice plan.

## Development

Requirements: Node 22+, pnpm 10+, Docker.

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL in Docker
docker compose up -d postgres

# 3. Create local environment file
cp .env.example .env

# 4. Run the panel backend
pnpm --filter @ice-panel/panel-backend dev

# 5. Verify
curl http://localhost:3000/health
# → {"status":"ok","db":"ok"}
```

## References

Internal research notes compiled while designing Ice-Panel — see [docs/references/](./docs/references/):

- Hysteria2, AmneziaWG, NaiveProxy, Xray-core — operational references for each upstream
- Remnawave — competitor analysis (architecture, modules, UX)

These complement the roadmap with deeper technical context for each adapter.

## License

[AGPL-3.0](./LICENSE)
