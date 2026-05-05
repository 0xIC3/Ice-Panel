# Panel Backend

Fastify-based control-plane API for Ice-Panel. Runs the admin REST endpoints,
the subscription generator, the panel→node mTLS transport, and the BullMQ
worker pool that fans user-mutations out to the node-agents.

## Stack

- **TypeScript** + **Node 22 ESM**
- **Fastify 5** — schema-first HTTP, hooks, plugins
- **Prisma 7** + **PostgreSQL 16** — schema, migrations, type-safe queries
- **Zod 4** — runtime validation, discriminated unions for inbound configs
- **BullMQ** + **Redis 7** — `nodeUsersQueue` for fan-out to nodes,
  `cronTasksQueue` for traffic-reset / review jobs
- **`@peculiar/x509`** + **undici** — mTLS keypair generation + outbound HTTPS
  with mutual auth
- **Pino** — structured JSON logs
- **JWT (`jose`)** + **bcrypt** + **`@fastify/rate-limit`** — admin auth

## Layout

```
src/
├── app.ts            buildApp() factory — used by index.ts and tests
├── index.ts          bootstrap (workers, schedulers, listen)
├── config.ts         Zod-validated env
├── prisma.ts         single PrismaClient instance
├── lib/              cross-cutting (credentials, redis, event-bus)
├── modules/
│   ├── auth/         JWT, register/login, requireAuth hook
│   ├── admin/        admin DB representation
│   ├── users/        users CRUD, traffic strategies, cron review jobs
│   ├── nodes/        nodes CRUD + mTLS transport (panel→node REST)
│   ├── inbounds/     inbounds CRUD with discriminated config schemas
│   ├── subscription/ /sub/:token + 6 format builders + ?format= dispatcher
│   ├── srr/          Subscription Response Rules — UA-driven format auto-select
│   ├── amneziawg/    IP allocator service (panel-side, persists peer→IP)
│   ├── keygen/       CA + per-node mTLS cert issuance
│   └── scheduler/    BullMQ queue + cron registration
├── core-adapters/    panel-side URI / config builders per protocol
└── tests/helpers/    Vitest fixtures (db cleanup, JWT auth)
```

## Develop

```bash
# From repo root
pnpm install
docker compose up -d postgres redis postgres-test
pnpm --filter @ice-panel/panel-backend exec prisma migrate dev
pnpm --filter @ice-panel/panel-backend dev
```

The dev server auto-reloads via `tsx watch`. **Note**: on Windows hosts file
events from /mnt/c paths sometimes don't propagate — restart the dev server
manually after schema or `app.ts` changes.

## Tests

Integration tests share a single test-Postgres on `:5433` (`postgres-test`
service in `docker-compose.yml`). `vitest.config.ts` sets `fileParallelism:
false` to avoid races on `cleanDatabase()` and unique constraints.

```bash
pnpm --filter @ice-panel/panel-backend test            # all 193 tests
pnpm --filter @ice-panel/panel-backend test -- inbounds  # filter by path
pnpm --filter @ice-panel/panel-backend test:watch      # interactive
```

## Migrations

```bash
# Schema changed? Create a migration:
pnpm --filter @ice-panel/panel-backend exec prisma migrate dev --name <slug>

# Apply pending migrations to a remote DB:
DATABASE_URL=postgres://... pnpm exec prisma migrate deploy

# Regenerate the typed client without changing schema:
pnpm --filter @ice-panel/panel-backend exec prisma generate
```

Production deploys apply migrations via the dedicated `migrate` one-shot
service in `docker-compose.prod.yml` — see [`docs/deploy/install.md`](../../docs/deploy/install.md).
