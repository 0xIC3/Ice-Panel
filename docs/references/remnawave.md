---
name: Remnawave reference oracle (deep dive 2026-05-03)
description: Comprehensive map of Remnawave's architecture, REST API, auth, queues, scheduler, node lifecycle. The oracle for slice design — NOT a fork base.
type: reference
originSessionId: 652e2420-3ff6-4298-a3e6-48489cb0137f
---
Remnawave is a Russian-made AGPL-3.0 proxy panel built around Xray-core. We use it as battle-tested reference, NOT a fork base. Their entire architecture is Xray-locked (`vlessUuid`/`trojanPassword`/`ssPassword` baked into User schema; node uses `@remnawave/xtls-sdk` — Xray's gRPC API). We are multi-core. So patterns adapt, never copy.

---

## Repos in remnawave/* org

| Repo | Role | Stack | Stars |
|---|---|---|---|
| `backend` | Panel API | NestJS + Prisma + Postgres | 174 |
| `frontend` | Admin UI | React + Vite + Mantine | 111 |
| `node` | Node agent on each VPS | NestJS + nice-grpc + xtls-sdk + supervisord | 152 |
| `subscription-page` | Sub URL renderer | Separate service | 98 |
| `xtls-sdk` | TS SDK for Xray gRPC | TypeScript | 89 |
| `templates` | Deployment templates | Mixed | 68 |
| `migrate` | Migration from other panels | Go | 39 |
| `panel` | Docs site only (Docusaurus, NOT the app) | TS | 3856 |

---

## Tech stack

### Backend
- **NestJS v11** (Express platform, NOT Fastify)
- Prisma v6 + Kysely adapter + `prisma-kysely` codegen
- PostgreSQL
- Validation: Zod + nestjs-zod, **ZodValidationPipe global**
- Auth: Passport (JWT, HTTP) + @simplewebauthn/server + grammy (Telegram)
- Queue: BullMQ + @nestjs/bullmq + bull-board UI
- Redis: ioredis + @songkeys/nestjs-redis
- Cache: ioredis-based via `RawCacheModule`
- Scheduler: @nestjs/schedule (decorator `@Cron`)
- Logging: Winston + morgan
- Metrics: @willsoto/nestjs-prometheus
- HTTP client: @nestjs/axios + axios
- Other: dayjs, nanoid, superjson, yaml, helmet, compression
- Process mgmt prod: PM2 (`ecosystem.config.js`)

### Frontend
React 19 + Vite 7 + TS 5.9 + Mantine 8 + Mantine-React-Table + TanStack Query 5 + Zustand 5 + Axios + React Router DOM 6 + Highcharts/Recharts + Monaco editor + WebAuthn + DnD-Kit + React Virtuoso + i18next

### Node agent
NestJS + **nice-grpc** + `@remnawave/xtls-sdk` + `@remnawave/xtls-sdk-nestjs` + **supervisord** (via supervisord-nestJS) + nftables (IP control) + Passport JWT

---

## Bootstrap (backend `main.ts`)

- Server: `NestFactory.create<NestExpressApplication>(AppModule)` — Express
- Port: from `APP_PORT` env (`getOrThrow`)
- CORS: dev `'*'`, prod `FRONT_END_DOMAIN`, methods GET/HEAD/PUT/PATCH/POST/DELETE, no credentials
- Middleware order: helmet (CSP, CORP, referrer-policy) → compression → real-IP → morgan (conditional) → noRobots → proxyCheck
- Body parser: `json({ limit: '100mb' })`
- Validation: `app.useGlobalPipes(new ZodValidationPipe())`
- Swagger: pre-listen, with `patchNestJsSwagger()`
- Global prefix: `ROOT` from contracts

## AppModule composition

`RawCacheModule, AxiosModule, CommonConfigModule, PrismaModule, ClsModule (with TransactionalAdapterPrisma), EventEmitterModule (wildcard), IntegrationModules, RemnawaveModules, ConditionalModule, ServeStaticModule, QueueModule, RuntimeMetricsModule`

- `OnApplicationShutdown` for graceful shutdown
- **No throttling/rate-limiting module**

---

## REST API surface (130+ endpoints — full inventory)

URL prefix: configurable, all paths under `/api/`. Source of truth: `libs/contract/api/routes.ts`.

### Auth (8)
`POST /api/auth/login`, `POST /api/auth/register` (only if zero admins), `GET /api/auth/get-status`, `POST /api/auth/oauth2/telegram-callback`, `GET /api/auth/oauth2/authorize`, `GET /api/auth/oauth2/callback`, `GET /api/auth/passkey/get-authentication-options`, `POST /api/auth/passkey/verify-authentication`

### Passkeys (5)
get-all, delete, update, get-registration-options, verify-registration

### API tokens (3)
create, delete/{uuid}, get

### Keygen (1)
`GET /api/keygen/get` — fetches CA pubkey for nodes

### Nodes (6 + actions + bulk)
CRUD: create, get, get-by-uuid, update, delete, tags/get
Actions: enable, disable, restart, restart-all, reset-traffic, reorder
Bulk: profile-modification, actions, update

### Users (8 + actions + lookup + bulk = ~25)
CRUD: create, update, get (paginated), delete, get-by-uuid, accessible-nodes, sub-request-history, resolve, tags/get
Actions: disable, enable, reset-traffic, revoke-subscription
Lookup: get-by id/short-uuid/username/subscription-uuid/telegram-id/email/tag (7 distinct lookup endpoints!)
Bulk: delete-by-status, update, reset-traffic, revoke-subscription, delete, update-squads, extend-expiration-date, all/update, all/reset-traffic, all/extend-expiration-date

### Subscriptions (9)
get list, get-by username/uuid/short-uuid/short-uuid-raw, subpage/get-config, get-connection-keys-by-uuid, `/api/subscription/{shortUuid}` (the public sub URL), `/api/subscription/get-info/{shortUuid}`

### Subscription templates (6)
get/{uuid}, update, delete, get-all, create, actions/reorder

### Subscription settings, page configs, response rules
Standard CRUD per resource

### Hosts (6 + actions + bulk)
CRUD + reorder + bulk enable/disable/delete/set-inbound/set-port

### System (8)
- `/api/system/health` — healthcheck
- `/api/system/metadata`
- `/api/system/stats/system-stats`, `/bandwidth-stats`, `/nodes-stats`, `/nodes-metrics`, `/recap`
- `/api/system/tools/generate-x25519`, `/encrypt-happ-crypto-link`
- `/api/system/testers/srr-matcher` — test sub response rule matching

### Config profiles (8)
CRUD + get-inbounds-by-profile-uuid + get-computed-config-by-profile-uuid + get-all-inbounds + actions/reorder

### HWID (7)
get-all-hwid-devices, create-user-hwid-device, get-user-hwid-devices/{userUuid}, delete-user-hwid-device, delete-all-user-hwid-devices, stats, top-users-by-devices

### Internal squads (8)
CRUD + accessible-nodes + bulk-actions/add-users + remove-users + actions/reorder

### External squads (7) — same shape

### Infra billing (12)
providers CRUD + billing-nodes CRUD + billing-history CRUD

### Subscription request history (2)
get + stats

### Snippets (4) — ConfigProfile snippet store

### Node plugins (8 + torrent-blocker subroutes)
CRUD + executor + reorder + clone + torrent-blocker reports

### Bandwidth stats (6)
nodes/get, nodes/get-realtime (streaming), nodes/get-users/{uuid}, users/get-by-uuid/{uuid}, plus legacy versions

### IP control (5)
fetch-ips/{uuid}, get-fetch-ips-result/{jobId}, drop-connections, fetch-users-ips, get-fetch-users-ips-result

### Metadata (4)
node/get + node/upsert + user/get + user/upsert (JSONB metadata per entity)

### Remnawave settings (2) — get + update (singleton config)

**Pattern observation:** very granular per-action endpoints (`/actions/enable/{uuid}`, `/actions/disable/{uuid}`, `/actions/restart/{uuid}` instead of one PATCH). Fits well with audit-friendly REST and explicit operation typing on frontend.

---

## Auth subsystem (deep)

**Methods supported:**
1. **Password** — username + password via `POST /api/auth/login`
2. **Passkey/WebAuthn** — `@simplewebauthn/server`
3. **OAuth2** — GitHub, Yandex, PocketID, Keycloak, Generic, Telegram (multiple providers)
4. **Initial registration** — only allowed when zero admins exist (chicken-and-egg solved)

**JWT payload (minimal):**
```json
{ "username": "...", "uuid": "...", "role": "ADMIN" }
```

**JWT lifetime:** from env `JWT_AUTH_LIFETIME` in hours. **No refresh tokens** — re-auth on expiry.

**Password hashing — UNUSUAL choice:**
- Apply HMAC-SHA256 to plaintext password using JWT_SECRET as key
- scrypt the HMAC result with random 16-byte salt, output 64 bytes
- Storage format: `salt:hash`
- Compare with `crypto.timingSafeEqual()`
- **NOT bcrypt, NOT argon2** — choice probably for native-only crypto (no native deps)

**No rate-limiting on failed login.** `emitFailedLoginAttempt()` events fire but no lockout.

**No 2FA.** Passkey is primary, not second factor.

**No password reset flow.** Admin must reset via DB.

**Implications for us:**
- Use **bcrypt or argon2id** (industry standard) for our admin auth — Remnawave's choice is unconventional
- Single JWT no refresh is fine for MVP
- Add basic rate-limit for slice 5 — `@fastify/rate-limit` plugin
- Defer passkeys/OAuth2 to phase 3+

---

## User module (deep)

**Auto-generated at user creation:**
- `shortUuid` via nanoid with custom alphabet
- `trojanPassword`, `ssPassword` via `createPassword()`
- `vlessUuid` via `randomUUID()`
- (BigInt traffic limit wrapped via `wrapBigInt()`)

**On status=ACTIVE creation:** publishes `AddUserToNodeEvent` (CQRS event bus).

**Update operation:**
- Allowed: trafficLimitBytes, expireAt, description, hwidDeviceLimit, tags, squad assignments, status, email, telegramId
- Forbidden: uuid, username (immutable post-creation)
- Side-effect: traffic-limit change resets `lastTriggeredThreshold` to 0

**Status transitions:**
- ACTIVE → DISABLED: `RemoveUserFromNodeEvent`
- ACTIVE → LIMITED: triggered async by traffic exceeded scan
- LIMITED → ACTIVE: traffic reset OR limit increase, fires `AddUserToNodeEvent`
- EXPIRED → ACTIVE: only when `expireAt` moves to future

**Bulk operations dispatch to BullMQ:**
- `bulkDeleteUsersByStatus()` → queue
- `bulkUpdateUsers()` → queue (rejects EXPIRED/LIMITED in dto)
- `bulkUpdateUsersInternalSquads()` → remove from old, add to new, sync nodes
- `bulkExtendExpirationDate()` → mass-update + AddUserToNodeEvent for each previously-expired

**Node sync via events (CQRS):**
- `eventBus.publish(new AddUserToNodeEvent(updatedUser.uuid))`
- Subscription revocation: passes OLD vlessUuid for cleanup
- Bulk variant: `AddUsersToNodeEvent` (plural)
- Audit/logging: separate `EventEmitter2` (different from CQRS bus)

---

## Subscription subsystem (deep)

**URL pattern:** `https://${SUB_PUBLIC_DOMAIN}/${shortUuid}` — short, no path prefix.

**Supported formats (`subscriptionTemplate.templateType`):**
- `XRAY_JSON` — Xray native config
- `XRAY_BASE64` — Base64-encoded URI list (rejected during template creation as "unsupported", probably hard-coded fallback)
- `MIHOMO` — Clash/Mihomo YAML
- `STASH` — Stash YAML
- `SINGBOX` — Sing-box JSON
- `BROWSER` — HTML page (when curl'd by browser)

**Default templates** stored as constants in `./constants` and assigned at template creation.

**Format detection:** **not via Accept-header**, but via SRR (Subscription Response Rules) Matcher Service against User-Agent headers. Custom regex rules per format.

**Rendering:**
- Programmatic, NOT string-template substitution
- YAML: `yaml.parse(template.templateYaml)` → object → mutate with user/host info → `yaml.stringify`
- JSON: native object → mutate → `JSON.stringify`
- Validation of "remnawave injector" sections (regex/tag rules) for security

**Caching:** subscription settings + external squad settings cached. Templates: 3600s TTL.

**Access control before rendering:**
- User existence check
- HWID device limit check (returns empty body or 403 if exceeded)
- `subRevokedAt` check
- Status check (DISABLED/EXPIRED returns special response)

**Implication for us:** start with single format (Hysteria2 native URI `hy2://...`), add others one-by-one in phase 2. Pre-allocate subscriptionToken at user creation, never expose long internal UUID.

---

## Node management (deep)

### Panel side (`nodes.service.ts`)
- High-level orchestration: create, update, delete, enable/disable, restart, reset-traffic
- DB writes
- Triggers `nodesQueuesService.startNode({nodeUuid})` for actual networking
- `nodes-system-cache.service` caches node system info (CPU, RAM, uptime — pulled from nodes)
- Initial state: `isConnected: false, isConnecting: false`
- Event: `EVENTS.NODE.MODIFIED` published on changes

### Networking layer (`NodesQueuesService` + processors)
- 11 BullMQ queues: start-node, stop-node, start-all-nodes, start-all-nodes-by-profile, query-nodes, node-health-check, node-bulk-users, node-users, record-node-usage, record-user-usage, node-plugins
- Deduplication on `START_ALL_NODES` (only one in-flight)
- Standard BullMQ options: `removeOnComplete: true, removeOnFail: true`
- **Actual HTTP-mTLS calls happen in queue processors**, abstracted from service layer

### Node side
- HTTPS server with **mTLS** (client cert verification): `requestCert: true, rejectUnauthorized: true, ca: [caCertPem]`
- Listens on `NODE_PORT` env var
- Internal Unix socket on `INTERNAL_SOCKET_PATH` for cross-component IPC
- mTLS bootstrap: `parseNodePayload()` reads node key/cert + CA cert from environment (passed at deploy)
- Keepalive: 60s `keepAliveTimeout`, 61s `headersTimeout`

### Node `handler.service.ts` exposes
- `addUser`, `removeUser`, `addUsers` (bulk), `removeUsers` (bulk), `getInboundUsers`, `getInboundUsersCount`, `dropUsersConnections`, `dropIps`, `removeOutbound`
- Each operation: removes user from ALL inbound tags first, then re-adds across `Trojan/VLESS/Shadowsocks/Hysteria` protocols (yes Hysteria mentioned, but managed through Xray Hysteria adapter not native binary)
- Uses `XtlsApi` from xtls-sdk: `xtlsApi.handler.addVlessUser(...)`, etc.
- `dropUsersConnections` → publishes `DropConnectionsEvent` → cleans up
- Capability check at boot: `if (!hasCapNetAdmin())` — needs CAP_NET_ADMIN for IP tracking

### Node `xray.service.ts` (process mgmt)
- Uses `SupervisordClient` (XML-RPC to supervisord)
- `XRAY_PROCESS_NAME = 'xray'`
- Operations: `supervisordApi.startProcess('xray', true)`, `stopProcess(...)`, `getProcessInfo(...)`
- supervisord state code 20 = RUNNING
- Config gen: `generateApiConfig({ config: body.xrayConfig, torrentBlockerState, internal })` builds full Xray JSON
- **Reload strategy: full restart**, not hot reload (`shouldRestart = isNeedRestartCore(hashes)` — compares config hashes)
- Health check: gRPC `xtlsSdk.stats.getSysStats()` with **10 retries × 2s interval**
- Crash detection: failed `getSysStats()` triggers warn log + restart attempt
- Specific known error: `XML-RPC fault: SPAWN_ERROR: xray` logged with detailed context

---

## Keygen (mTLS bootstrap)

- Single CA per panel installation, stored in DB (`Keygen` table from schema)
- Pre-stored: `caCert`, `caKey`, `clientCert`, `clientKey`, plus `privKey`/`pubKey` for JWT signing
- On node creation: `generateNodeCert(pubKey.caCert, pubKey.caKey)` produces `nodeCertPem` + `nodeKeyPem`
- Bundled into encoded payload: `encodeCertPayload({ nodeCertPem, nodeKeyPem, caCertPem, jwtPublicKey })` — passed to node operator at deploy
- Node decodes payload at boot via `parseNodePayload()` and uses for mTLS server

**Key cert library used:** `@peculiar/x509` and `@peculiar/webcrypto` (visible in package.json deps).

**Implication for us:** same pattern works. Generate CA once at panel init, store in DB. Issue per-node cert. Hand encoded payload to admin to deploy on node VPS. Renewal: regenerate periodically; node fetches new cert from panel via existing mTLS.

---

## Cron jobs / scheduler (FULL inventory)

Source: `src/scheduler/intervals.ts` (constants) + `@Cron` decorators inside individual modules' services.

### Real-time stats & health
| Schedule | Constant | Purpose |
|---|---|---|
| every 10s | NODE_HEALTH_CHECK | Ping each node via mTLS, update `isConnected`/`lastStatusChange` |
| every 15s | METRIC_EXPORT_METRICS | Push gauges/counters to Prometheus |
| every 15s | RECORD_USER_USAGE | Pull per-user traffic delta from each node |
| every 30s | RECORD_NODE_USAGE | Pull total node bandwidth |

### Status reviews (set status fields based on conditions)
| Schedule | Constant | Sets |
|---|---|---|
| every 30s | REVIEW_USERS.FIND_EXPIRED_USERS | `status='EXPIRED'` for `expireAt < NOW` |
| every 45s | REVIEW_USERS.FIND_EXCEEDED_TRAFFIC_USAGE_USERS | `status='LIMITED'` for over-quota |
| every hour | REVIEW_NODES | re-evaluate nodes with stale `lastSeenAt` |

### Notifications (find-and-dispatch)
| Schedule | Constant | Action |
|---|---|---|
| every 1m | EXPIRE_NOTIFICATIONS | Notify users on expiring soon |
| every 5m | BANDWIDTH_USAGE_NOTIFICATIONS | Notify on traffic threshold |
| every 10m | NOT_CONNECTED_USERS_NOTIFICATIONS | Notify on inactive users |

### Traffic resets (FOUR separate jobs, one per strategy!)
| Schedule | Constant | What |
|---|---|---|
| daily 00:05 | RESET_USER_TRAFFIC.DAILY | Reset users with `trafficLimitStrategy='DAY'` |
| daily 00:10 | RESET_USER_TRAFFIC.MONTHLY_ROLLING | For `'ROLLING_MONTH'` — rolling 30 days from `lastTrafficResetAt` |
| Mondays 00:15 | RESET_USER_TRAFFIC.WEEKLY | For `'WEEK'` |
| 1st of month 00:20 | RESET_USER_TRAFFIC.MONTHLY | For `'MONTH'` (calendar) |
| daily 01:00 | RESET_NODE_TRAFFIC | Node-level (when `trafficResetDay` matches) |
| daily 17:00 | CRM.INFRA_BILLING_NODES_NOTIFICATIONS | Billing reminders |

### Maintenance
| Schedule | Constant | What |
|---|---|---|
| every 6h | METRIC_SYNC_METRICS | Aggregate metrics for export |
| Mondays 00:30 | SERVICE.CLEAN_OLD_USAGE_RECORDS | Purge old `nodes_user_usage_history` |
| Mondays 00:45 | SERVICE.VACUUM_TABLES | Postgres `VACUUM` for bloat |

### Where these live
NOT in `src/scheduler/tasks/` (only has crm/export-metrics/reset-node-traffic/review-nodes — for node-level stuff). User-related crons are inside individual modules' services as `@Cron(CRON_EXPRESSION)` methods. The `intervals.ts` is just a constants file.

---

## Queue architecture

### User queues (7)
From `users-queues.service.ts`:

| Queue | Concurrency | Purpose |
|---|---|---|
| `MODIFY_MANY` | (default) | Bulk user mod (extend expire, update fields) |
| `SERIAL_OPERATIONS` | **1** | Operations needing strict ordering |
| `SUBSCRIPTION_REQUESTS` | (default) | Sub URL fetch logging |
| `RESET_USER_TRAFFIC` | **1** | Traffic resets |
| `USERS_WATCHDOG` | 2 | Find-expired/find-exceeded scans |
| `USER_EVENTS` | (default) | Event dispatch (e.g., torrent-blocker hits) |
| `UPDATE_USERS_USAGE` | **5** | Apply per-user traffic deltas (high frequency) |

**Chunking:**
- Bulk events: 3000-item batches via lodash `chunk()`
- Usage updates: 1500-item chunks via custom async generator

### User processors (BullMQ workers)
1. `modify-many-users.processor.ts`
2. `reset-user-traffic.processor.ts`
3. `serial-operations.processor.ts`
4. `subscription-requests.processor.ts`
5. `update-users-usage.processor.ts`
6. `user-events.processor.ts`
7. `users-watchdog.processor.ts`

### Node processors (12)
1. `node-bulk-users.processor.ts`
2. `node-health-check.processor.ts` — runs cron-style on health-check queue
3. `node-plugins.processor.ts`
4. `node-users.processor.ts`
5. `query-nodes.processor.ts`
6. `record-node-usage.processor.ts`
7. `record-user-usage.processor.ts`
8. `start-all-nodes-by-profile.processor.ts`
9. `start-all-nodes.processor.ts` (deduplicated)
10. `start-node.processor.ts`
11. `stop-node.processor.ts`

**Key insight:** Their pattern is **scheduled task → enqueue job → processor calls node**. Not direct sync calls. This decouples scheduler from networking, retries on failure, gives BullMQ observability via bull-board UI.

---

## Notifications (`integration-modules/notifications`)

Two channels:
1. **Telegram bot** — via `grammy` + `@grammyjs/parse-mode`, in `telegram-bot/` subdir
2. **Webhooks** — generic HTTP POST, in `webhook-module/` subdir
- (no built-in email)

---

## Data flow recap (full)

### Admin creates user
```
Browser → POST /api/users/create
       → users.service.create()
         → repo.create() (Prisma INSERT)
         → eventBus.publish(AddUserToNodeEvent)
       → CQRS handler queues node-users job (per affected node)
       → BullMQ processor → mTLS HTTPS POST to node /addUser
                          → handler.service.addUser()
                          → xtlsApi.handler.addVlessUser/addTrojanUser/...
                          → returns OK
       → response 200 with subscription URL
```

### User connects
```
Hysteria2 client → GET https://sub.example.com/{shortUuid}
              → subscription.controller
                → ResponseRulesMatcher (UA check) → MIHOMO/SINGBOX/etc
                → renderTemplatesService.generateSubscription({user, hosts, ...})
                → returns YAML/JSON config
              → client connects to node:port
              → Xray on node validates user via internal cred check (vlessUuid/etc)
              → traffic flows
```

### Stats sync
```
[every 15s] BullMQ job RECORD_USER_USAGE
        → for each connected node:
          → mTLS POST /getUserUsage to node
          → node: xtlsApi.stats.getUserStats() (gRPC to xray)
          → returns {userId, downlink, uplink}
        → UPDATE_USERS_USAGE queue (batch 1500)
        → processor: UPDATE user_traffic SET used_traffic_bytes = used_traffic_bytes + ?
```

### Auto-reset (e.g., daily strategy)
```
[daily 00:05 cron] RESET_USER_TRAFFIC.DAILY
        → SELECT users WHERE traffic_limit_strategy = 'DAY'
        → enqueue RESET_USER_TRAFFIC jobs (chunked)
        → processor: 
          UPDATE users SET data_used_bytes = 0, last_traffic_reset_at = NOW(),
                          status = CASE WHEN status='LIMITED' THEN 'ACTIVE' ELSE status END
          IF was LIMITED → publish AddUserToNodeEvent → re-enable on nodes
```

---

## Patterns to STEAL for Ice-Panel

1. **Per-user `traffic_limit_strategy`** with 4 cron jobs (daily/weekly/monthly/rolling)
2. **Split `users` ↔ `user_traffic`** for write-hot fields
3. **`lifetime_traffic_bytes`** never resets
4. **Pre-generate creds at user creation** for OUR protocols (`hysteria_password`, `amneziawg_keys`, `naive_password`, `xray_uuid`)
5. **Squads from day one** — m2m membership + m2m group→inbound
6. **REST + mTLS for panel↔node** (drop gRPC plan)
7. **Scheduled task → queue → processor pattern** — don't call nodes directly from cron
8. **BullMQ with concurrency limits** — serial-ops=1, traffic-reset=1, usage=5
9. **Event-driven user sync** — emit `AddUserToNodeEvent` on status change, handler queues node updates
10. **Granular per-action endpoints** (`/actions/enable/{uuid}`) — clearer than PATCH
11. **Bulk + bulk-all variants** for every operation
12. **Multiple lookups for users** by id/username/sub-uuid/telegram/email/tag — frontend convenience
13. **Frequent reviews (30/45s) for status fields** — eventual consistency
14. **Per-format subscription templates** parsed and mutated as objects (NOT string substitution)
15. **Granular healthcheck** every 10s — fast detection of node failure
16. **`@peculiar/x509` for mTLS cert generation** — same library
17. **Single CA per panel** stored in DB Keygen table
18. **Encoded payload for node bootstrap** (cert + key + CA + JWT pubkey in one string)
19. **`SubscriptionRequestHistory`** for audit and abuse detection
20. **`hwid_device_limit` enforced at sub URL fetch time**, not at connection
21. **Frontend: Mantine 8 + TanStack Query + Zustand** — copy stack 1:1
22. **Helmet + compression + Zod global validation** for backend bootstrap
23. **CLS module + transactional middleware** for request-scoped DB transactions
24. **`isProfileWebpageUrlEnabled`** — alternative HTML page when sub URL hit by browser

## Patterns to ADAPT (not copy)

1. NestJS → use Fastify (lighter for solo dev)
2. CQRS+DDD per module → simpler routes/services/repositories for MVP, refactor in slice 6
3. Hosts/ConfigProfiles abstraction → flat `nodes → inbounds` for MVP
4. xtls-sdk dependency → CoreAdapter per protocol (this is OUR differentiation)
5. Express → Fastify
6. Multi-format sub from start → only Hysteria2 in slice 11, more in phase 2
7. Passkeys/OAuth2 → JWT only for MVP, expand in phase 3
8. PM2 → Docker for prod
9. Bull-board → not needed at our scale yet
10. Their password hash (HMAC+scrypt) → use industry-standard `bcrypt` or `argon2id`
11. Their lack of rate-limit → add `@fastify/rate-limit` from slice 5
12. 27 modules → start with ~10 essential

## Things they HAVE we should add to roadmap

1. `subscription_request_history` for audit
2. Health-check cron for nodes (every 10s seems right for our scale, maybe 30s)
3. Notifications module (Telegram + webhook) — phase 2/3
4. Bandwidth stats endpoints with realtime streaming — phase 2
5. Bulk operations on users — even basic ones save admin time

## Things we have they DON'T

1. **Native multi-core** — our entire reason to exist
2. **Soft-delete** — they hard-delete users (we keep `deleted_at`)
3. **`subscription_events` audit log** — their separate `UserSubscriptionRequestHistory` only logs sub fetches, not state changes
4. **CoreAdapter abstraction** — they're locked to Xray

---

## Recipes by slice

| Our slice | Look at |
|---|---|
| 2 (Postgres) | env validation pattern (`getOrThrow`), prisma DATABASE_URL |
| 3 (Prisma + User) | full `prisma/schema.prisma`, especially Users/UserTraffic/InternalSquads |
| 4 (POST /users + Zod) | `libs/contract/api/routes.ts` for endpoint shapes; `users.service.create()` for auto-cred logic |
| 5 (JWT auth) | `auth.service.ts` for flow, but **use bcrypt** instead of HMAC+scrypt; add rate-limit |
| 6 (layers) | their module structure — heavily simplify |
| 7 (Vitest) | (their tests aren't visible in WebFetch — only structure) |
| 8 (RPC) | **STOP**: they use REST+mTLS not gRPC. Reconsider. mTLS via `@peculiar/x509`, payload encoding pattern |
| 9 (Go agent) | their handler.service.ts methods (addUser/removeUser/getStats/dropConnections) — copy METHOD NAMES, but Go impl |
| 10 (CoreAdapter) | their `xray.service.ts` for inspiration on supervisord, but multi-core is OURS |
| 11 (E2E Hysteria2) | nothing — not their domain |
| 12 (frontend) | full stack: React 19 + Vite + Mantine + TanStack Query + Zustand. Borrow component layouts from frontend repo |
| 13 (Docker) | their `docker-compose-prod.yml`, multi-stage Dockerfile, ecosystem.config.js |

---

## Refresh policy

This snapshot: **2026-05-03**. Re-fetch:
- Before slice 5 (auth) — verify auth/scrypt approach didn't change
- Before slice 8 (RPC) — verify REST+mTLS still their choice
- Before slice 12 (frontend) — get latest UI components/screens
- Quarterly otherwise

If `git log` of `remnawave/backend` shows major version (3.x → 4.x), redo this entire memory.
