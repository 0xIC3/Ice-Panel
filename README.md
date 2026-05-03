# Ice-Panel

Self-hosted proxy management panel with **native multi-core support**.

## Status

🚧 **Early development.** Phase 1 (MVP with Hysteria2) in progress — see [docs/ROADMAP.md](./docs/ROADMAP.md) for the full 15-slice plan and progress.

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
| Background jobs | Redis, BullMQ, eventemitter2 |
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

## License

[AGPL-3.0](./LICENSE)
