---
name: Remnawave per-module deep-dive (gap-fill)
description: Detailed implementation findings for modules previously known only superficially. Companion to reference_remnawave.md. Snapshot 2026-05-04.
type: reference
originSessionId: 652e2420-3ff6-4298-a3e6-48489cb0137f
---
Per-module deep dive of `github.com/remnawave/backend` filling gaps from initial reference. Snapshot 2026-05-04. Use when designing equivalent Ice-Panel features.

## 1. Internal Squads — `src/modules/internal-squads/`

**What it actually is:** named groupings of inbound UUIDs. User in squad A → access to inbounds squad A lists. Core authorization primitive.

**Key behavior:**
- Reserved name `Default-Squad` is hard-blocked
- `syncInternalSquadInbounds` does **clean-and-replace** (not diff): deletes all join-table rows for squad, reinserts
- All ops `@Transactional()`
- **No caching** for internal squads (unlike external) — read directly from PG each request

**Smart trick — node-restart targeting:**
On inbound change, computes `Map<configProfileUuid, Set<inboundUuid>>` for old/new state, uses **`Set.prototype.symmetricDifference`** (ES2025, requires Node 22+) to find profiles whose inbound membership changed. Only those affected profiles trigger `nodesQueuesService.startAllNodesByProfile`. Avoids "restart everything on squad change".

**Member ops are async:** `addUsersToInternalSquad` / `removeUsersFromInternalSquad` only emit queue job, return immediately. Worker does actual user→squad assignment. Critical at 10k+ members.

**Surprising:**
- Clean-and-replace under transaction → with 10k+ users, large transactional writes per squad edit
- `symmetricDifference` Stage 4 ES proposal — locks to recent Node

**Ice-Panel relevance: HIGH.** Pattern (squad = inbound set, user.squads many-to-many) directly portable. Async user-add via queue is must-have. Skip `symmetricDifference` cleverness — simpler `Set` diff fine.

---

## 2. External Squads — `src/modules/external-squads/`

**Different concept from internal squads despite shared name.**
- Internal squad = "what inbounds does this user get" (authorization)
- External squad = **user-facing branding/policy bucket** (presentation)

Each user has **at most one** `externalSquadUuid` (nullable).

**Entity fields:**
- `uuid`, `name`, `viewPosition`
- `subscriptionSettings: ExternalSquadSubscriptionSettingsSchema | null`
- `hostOverrides: ExternalSquadHostOverridesSchema | null`
- `responseHeaders: ExternalSquadResponseHeadersSchema | null`
- `hwidSettings: THwidSettings | null`
- `customRemarks: TCustomRemarks | null`
- `subpageConfigUuid: string | null`
- `templates [{ templateUuid, templateType }]` (m:n)

**What each JSON field does:**
- `subscriptionSettings` — overrides global sub settings (delivery format, includes/excludes)
- `hostOverrides` — passed to `RenderTemplatesService.generateSubscription` → `ResolveProxyConfigService.resolveProxyConfig({ subscriptionSettings, hosts, user, hostsOverrides })`. Lets a squad rewrite host fields (server, port, sni) before template generation. **VIP users get different SNI without changing inbound.**
- `responseHeaders` — extra HTTP headers (custom `Subscription-Userinfo`, branded `Profile-Title`)
- `customRemarks` — overrides node naming/labels in rendered config (visible client-side)
- `hwidSettings` — per-squad override of global HWID enforcement; **promoted over global if present**
- `subpageConfigUuid` — selects sub-page CSS theme/branding
- `templates` — selects template rows of each `templateType` (CLASH/SINGBOX/etc.) for this squad

**Real cache exists** (unlike internal): `GetCachedExternalSquadSettingsQuery` via `RawCacheService` with `CACHE_KEYS.EXTERNAL_SQUAD_SETTINGS(uuid)` TTL. Update/delete explicitly `rawCacheService.del(...)`.

**External squads do NOT restart nodes** — pure read-time presentation config. Architectural separation from internal squads.

**Ice-Panel relevance: MEDIUM-HIGH.** Split (internal=ACL, external=presentation/branding) excellent. But Remnawave's `hostOverrides`/`customRemarks` keyed to Xray template fields — for multi-core we need CoreAdapter-level "presentation override" abstraction, generalized.

---

## 3. HWID Device Tracking — `src/modules/hwid-user-devices/`

**CRITICAL: HWID value comes from CLIENT, not server.** `createUserHwidDevice` accepts `dto.hwid` from request body — server doesn't generate or hash. The HWID is whatever string the client (Happ, FoxRay, custom) sends via `x-hwid` header on subscription requests. Server only deduplicates `(userUuid, hwid)`.

**Enforcement at subscription request (verbatim):**
```ts
let hwidSettings: THwidSettings | undefined;
const subscriptionSettings = await queryBus.execute(new GetCachedSubscriptionSettingsQuery());
if (subscriptionSettings.hwidSettings.enabled) {
  hwidSettings = subscriptionSettings.hwidSettings;
}
if (user.response.externalSquadUuid) {
  const externalSquadSettings = await queryBus.execute(
    new GetCachedExternalSquadSettingsQuery(user.response.externalSquadUuid),
  );
  if (externalSquadSettings && externalSquadSettings.hwidSettings) {
    hwidSettings = externalSquadSettings.hwidSettings;  // override wins
  }
}
if (hwidSettings && hwidSettings.enabled) {
  const count = await this.hwidUserDevicesRepository.countByUserUuid(dto.userUuid);
  const deviceLimit = user.response.hwidDeviceLimit ?? hwidSettings.fallbackDeviceLimit;
  if (count >= deviceLimit) return fail(ERRORS.USER_HWID_DEVICE_LIMIT_REACHED);
}
```

Settings precedence: **global → external squad override → per-user hard limit**.

`THwidSettings = { enabled: boolean, fallbackDeviceLimit: number }`. Per-user `users.hwidDeviceLimit` beats fallback.

**Recent (Apr 7-8, 2026):**
- Race condition fix on count→insert (TOCTOU)
- Schema migration to numeric user_id for HWID-side joins (perf)
- Request IP added to schemas
- (May 2) Header `x-hwid-limit` → `x-hwid-active` (clients see active count, not cap)

**Surprising:**
- Trust model: client sends own HWID, no server validation. Determined user trivially rotates HWIDs. Model is "honest user with misbehaving family member", NOT anti-cheat.
- No automatic eviction of old HWIDs — admin/user manual delete only.
- TOCTOU recently patched.

**Ice-Panel relevance: HIGH.** Same model used by all VPN panels. Settings hierarchy correct. Adopt verbatim. **Fix TOCTOU from day one** — unique index on `(userUuid, hwid)` exists, but use `INSERT...RETURNING` with count+constraint in same transaction.

---

## 4. Subscription Templates — `src/modules/subscription-template/`

**5 first-class formats:** CLASH, MIHOMO, STASH, SINGBOX, XRAY_JSON. **6th XRAY_BASE64 exists at response-type level but cannot be created as user-editable** — auto-generated from host list.

**Default templates** (`constants/default-templates.ts`):
- **MIHOMO/CLASH** — `mixed-port: 7890`, fake-IP DNS `198.18.0.0/16`, mode global, empty `proxies:` marked `# LEAVE THIS LINE!`, single proxy-group `→ Remnawave`, `rules: - MATCH,→ Remnawave`
- **STASH** — Mihomo + extra `SCRIPT,quic,REJECT`, DOMAIN-SUFFIX rules for Apple/torrent, `GEOIP,LAN,DIRECT`
- **SINGBOX** — JSON with TUN inbound `tun125`, mixed inbound 2412, FakeIP `198.18.0.0/15`, selector outbound `→ Remnawave`
- **XRAY_JSON** — DNS `1.1.1.1/1.0.0.1`, BitTorrent → direct, SOCKS:10808 + HTTP:10809, freedom + blackhole

**The "remnawave injector" mechanism** (from `clash.generator.service.ts`):

`# LEAVE THIS LINE!` comments are decorative — NOT parsed. Real marker is **proprietary `remnawave:` key** templates can put inside any proxy-group, proxy-provider, or top-level. Generator extracts and deletes after processing:

```ts
const { remnawave, ...cleanConfig } = yamlConfig ?? {};
const remnawaveConfig = remnawave as Record<string, unknown> | undefined;
// ...
(yamlConfig.proxies as ProxyNode[]).push(...data.proxies);
// per group:
const remarks = this.resolveGroupRemarks(group, proxyRemarks);
(group.proxies as string[]).push(...remarks);
// remnawave object deleted before yaml.stringify
```

**Group-level `remnawave` directives:**
- `include-proxies: false` — group skips all proxies
- `select-random-proxy: true` — pick random
- `shuffle-proxies-order: true` — randomize order
- `remarkRegex`, `tagRegex` (in xray-json injector)

**XrayJSON has most powerful injector:** filter candidate hosts by `uuids`, `remarkRegex`, `sameTagAsRecipient`, `tagRegex`, with `source` filter (ALL/HIDDEN/NOT_HIDDEN). Per-host `clientOverrides.xrayJsonTemplate` can entirely replace base template for one host. (Apr 10) ECH supported.

**Caching:** `getCachedTemplateByType(type, overrideTemplateName)` — Redis, **1 hour TTL**, parses YAML once. Active template change = up to 1h to propagate unless cache busted manually (service `del`s on update/delete).

**Ice-Panel relevance: MEDIUM.** Template-with-injector pattern is gold. But formats bound to Xray ecosystem — for AmneziaWG/Hysteria2-native need new template families. Plan: keep engine, add `AMNEZIA_CONF`, `HYSTERIA2_YAML` template types.

---

## 5. Subscription Response Rules (SRR) — `src/modules/subscription-response-rules/`

**Goal:** decide response format/status code/modifications per request based on **HTTP request headers** (primarily UA, but any header).

**Architecture:**
- `response-rules-parser.service.ts` — Zod-validates SRR config; pre-compiles regex via `new RegExp(...)` (fail-fast on bad patterns)
- `response-rules-matcher.service.ts` — runs rules against incoming request
- `middleware/response-rules.middleware.ts` — Express middleware wires it at request time

**10 operators per condition:**
`EQUALS`, `NOT_EQUALS`, `CONTAINS`, `NOT_CONTAINS`, `STARTS_WITH`, `NOT_STARTS_WITH`, `ENDS_WITH`, `NOT_ENDS_WITH`, `REGEX`, `NOT_REGEX`. Each has `headerName`, `value`, `caseSensitive`.

Rules combine with `operator: AND | OR` across conditions. **First matching enabled rule wins.**

**Match outputs (`matchedResponseType`):**
- Format: `XRAY_BASE64` | `CLASH` | `MIHOMO` | `STASH` | `SINGBOX` | `XRAY_JSON`
- "Deny": `BLOCK` (403), `STATUS_CODE_404`, `STATUS_CODE_451`, `SOCKET_DROP` (literally `socket.destroy()`)
- `BROWSER` — serves HTML

**Override path:** before rules run, middleware checks override client type (probably `?clientType=` query). If subscription disabled + override set → `BLOCK`.

**Recent (Mar 28-29, 2026):** "extended client" detection via `additionalExtendedClientsRegex`, passed downstream as `srrContext.isExtendedClient`. Used to gate modern-client-only features (ECH, mux).

**Surprising:** No UA magic — literally just header matching. Operator writes patterns. No "is this Clash Verge?" helper.

**Ice-Panel relevance: HIGH.** UA-based response-format selection is universal. Flat 10-operator + AND/OR design portable. Implement once, reuse across cores. `BLOCK`/`SOCKET_DROP`/`451` repertoire = nice anti-scraping/anti-leak set.

---

## 6. Node Plugins — `src/modules/node-plugins/`

**Plugin contract:** JSON config row in `NodePlugin` table named by admin, `pluginConfig: object` Zod-validated. Node binary reads on boot/sync. Currently only **torrent-blocker** (iptables/nftables BitTorrent detector) shipped.

**Lifecycle:**
- CRUD: `getAllConfigs`, `getConfigByUuid`, `createConfig` (seeds w/ `EXAMPLE_NODE_PLUGIN_CONFIG`), `updateConfig` (Zod), `deleteConfig`, `cloneNodePlugin` (creates `Clone {nanoid(5)}`), `reorderNodePlugins`
- After update/delete: `syncNodePlugins(pluginUuid)` queries nodes referencing this plugin via `GetNodesByPluginUuidQuery`, calls `nodeQueuesService.syncNodePluginsBulk`

**Executor — runtime control:**
```ts
data.targetNodes = { target: 'allNodes' } | { target: 'specific', nodeUuids: string[] }
data.command =
  | { command: 'blockIps',   ips: string[] }
  | { command: 'unblockIps', ips: string[] }
  | { command: 'recreateTables' }
```
For each connected node (`isConnected:true, isDisabled:false, isConnecting:false`), queues `nodeQueuesService.blockIps/unblockIps/recreateTables`. Failure: `CONNECTED_NODES_NOT_FOUND`.

**Torrent-blocker reports:**
- `GET reports` — paginated, `filters/filterModes/globalFilterMode/sorting` (full server-side table sort/filter)
- `GET stats` — aggregates `getStats() + getTopTorrentBlockerUsers() + getTopTorrentBlockerNodes()`
- `POST truncate` — wipes all reports

**Workflow:** torrent-blocker on each node detects torrent traffic → reports back as `TorrentBlockerReport` rows. Admin sees top offenders → `executePluginCommand` to `blockIps`.

**Surprising:** plugin contract generic (`pluginConfig: object`) — torrent-blocker is one impl, could ship more on same plumbing. But executor commands hardcoded as closed switch — adding new plugin command requires backend release.

**Ice-Panel relevance: MEDIUM.** Plugin pattern (config in PG, sync to nodes via queue, executor) excellent. We'd want **more open executor (typed RPC?)** so cores register their own commands. Torrent-blocker iptables-level → core-agnostic, ships as-is.

---

## 7. InfraBilling — `src/modules/infra-billing/`

**What it actually is: CRM-lite for infrastructure costs, NOT user billing.** Tracks which VPS/dedicated provider hosts which node, when each rental renews.

3 tables:
- `InfraProvider` — vendor record
- `InfraBillingNode` — link `provider ↔ node` with `nextBillingAt` date
- `InfraBillingHistory` — manual ledger of paid amounts

**No automatic billing.** Pure data layer. No events trigger creation, no payment integrations. Records appear when human POSTs to `/infra-billing/history`. `nextBillingAt` updated via `updateManyBillingAt` (admin marks "I paid for August").

**12 endpoints:** providers CRUD, history CRUD-minus-update, billing-nodes CRUD. Admin/API-role guarded.

**One scheduled task** (from `intervals.ts`):
```ts
CRM: { INFRA_BILLING_NODES_NOTIFICATIONS: CronExpression.EVERY_DAY_AT_5PM }
```
Daily at 17:00, scans nodes whose `nextBillingAt` approaches → Telegram notification. **The only automated behavior.**

**Surprising:** does NOTHING operational. Doesn't disable nodes when billing lapses. Provider/node link is informational. Many panels conflate this with user billing — Remnawave keeps strictly admin-side.

**Ice-Panel relevance: LOW.** Optional add-on. Pure CRUD + 1 cron. Skip until v2.

---

## 8. API Tokens — `src/modules/api-tokens/`

**Token format = JWT, NOT opaque.** Same secret as admin-login JWTs.

```ts
const payload = { uuid, username: null, role: ROLE.API };
return ok(this.jwtService.sign(payload, { expiresIn: '99999d' }));
```

**`expiresIn: '99999d'` ≈ 273 years.** Effectively never expires.

**No scopes.** Just `ROLE.API` payload value, distinguished from `ROLE.ADMIN` at `RolesGuard`. Most controllers `@Roles(ROLE.ADMIN, ROLE.API)`. Token management endpoints accept ADMIN only — **cannot manage API tokens from API token**.

**Storage and revocation:**
- DB: `ApiTokenEntity { uuid, tokenName, token, createdAt }` — stores full JWT
- Revocation: `delete(uuid)` deletes row + `rawCacheService.del('api:${uuid}')`
- Cache pattern suggests every API request validates token by Redis lookup `api:{uuid}` — **stateless JWT actually treated as session token for revocation**. Without cache, deleted token would still pass JWT verify.

**Surprising (mostly negative):**
- No scopes — API token is full-API minus token mgmt
- JWT-as-bearer-with-server-side-blacklist = known anti-pattern. Either fully stateless (short exp + refresh) OR fully opaque (random string in DB). Remnawave does worst of both.
- 99999d expiry will overflow some date math libs (year ~2299)

**Ice-Panel relevance: HIGH (negative learning). DON'T copy this.** Use opaque tokens (`crypto.randomBytes(32)`, hashed in DB) with proper scopes (`users:read`, `nodes:write`). Admin JWT story is fine.

---

## 9. Snippets — `src/modules/config-profiles/snippets.{controller,service}.ts`

Flat key-value store of named JSON-array fragments used inside config profiles.

```ts
class SnippetEntity { name: string; snippet: Prisma.JsonArray; createdAt: Date }
```

4 endpoints: GET, POST, PUT, DELETE on `/snippets`. Identified by `name` (unique key).

**Validation:**
- `snippet` must be non-empty array
- No empty objects inside
- Stored verbatim as `Prisma.JsonArray`

**Reuse:** spliced into Xray config-profile JSON when rendering. Typical: shared `routing.rules`, shared `dns.servers`, TLS fingerprint preset. Define once, reference by name from multiple profiles.

**Surprising:** tiny module — pure CRUD on JSON-fragment table. No template language, no variables, no parameters. Pure copy-paste-by-reference.

**Ice-Panel relevance: MEDIUM.** Useful when admins customize core configs. Trivial impl (~50 lines). Worth copying once we have config-profile editing.

---

## 10. Subscription Page (separate repo `remnawave/subscription-page`)

**Own NestJS app, NOT a feature in backend.** Repo: `frontend/` (React + Vite SPA, 81% TS) + `backend/` (NestJS Express server). Process title `rw-subpage`. Listens on `APP_PORT` (default 3010 in compose). Connects to existing `remnawave-network`.

**Standalone backend (`main.ts`) does:**
- Serves static SPA from `/opt/app/frontend` via `useStaticAssets`
- EJS view engine via `@ladjs/consolidate` for `.html` — entry HTML server-rendered with vars before React SPA hydrates
- Middleware: `cookieParser`, `noRobotsMiddleware` (X-Robots-Tag: noindex), `proxyCheckMiddleware`, `checkAssetsCookieMiddleware` (anti-hotlink), `getRealIp`, `helmet` (CSP off), `compression`, `morgan`
- CORS: `origin: '*', methods: GET` only
- Routes have `CUSTOM_SUB_PREFIX` global prefix (env)

**Relationship to backend:**
- Backend's `/api/subscription/{shortUuid}` → proxy clients hit directly, returns config bytes per matched format (§5)
- Human in browser hits same URL → SRR matches `BROWSER` → returns HTML 302/page linking to subscription-page
- Subscription-page calls backend via internal Docker network REST using `shortUuid` → gets user info + rendered subscriptions → presents styled page with copy-clipboard, OS detection, deeplinks (Happ, FoXray, V2RayN)
- `subpageConfigUuid` on user's external squad selects CSS theme/branding

**Why split:** (a) sub-page is most-customized surface — operators want own look — separable Docker image lets them swap without forking panel; (b) isolates public-facing service (untrusted user traffic, scrapers) from admin API.

**Surprising:** "backend" of subscription-page is mostly static-asset server with EJS. No DB, no business logic. All dynamic data from main backend's REST API. Calling it "backend" is generous — it's an SSR shell.

**Ice-Panel relevance: MEDIUM.** Architectural pattern (split user-facing page from admin API) good. For MVP, backend can serve page directly; build separate later. Note `subpageConfigUuid` indirection — operators theme without code changes.

---

## 11. Recent Changes Since 2026-05-04

`main` last release v2.7.4 (Mar 30 2026). `dev` has 30+ commits for 2.8.0 cycle.

**HWID & subscription request history (Apr 7-8):**
- Schema break: user identifier UUID → numeric ID across hwid + subscription request history
- Request IP added to schemas
- Race condition fix on count→insert
- (May 2) Header rename `x-hwid-limit` → `x-hwid-active`

**SRR / extended clients (Mar 29):**
- `additionalExtendedClientsRegex` to response rule modifications
- Extended client checks consolidated into single function

**Subscription generators (Apr 8-24) — heavy work:**
- (Apr 11) Hysteria2 in MihomoGeneratorService
- (Apr 24) Hysteria2 link generation in XrayGeneratorService
- (Apr 8-20) `xhttp` transport additions/refactors in Mihomo
- (Apr 11) `v2plus` client support in JSON subscription fallback clients
- (Apr 10) ECH settings in XrayJsonGeneratorService
- (Apr 10) Bug fix: exclude recipient UUID from candidate selection in XrayJsonGeneratorService
- (Apr 15) Rename: `fingerprint` → `client-fingerprint` in MihomoGeneratorService
- (Apr 22) bump 2.8.0

**Templates:**
- (May 1) Template transformation support for base64 encoding in TemplateEngine — new transform function callable from templates
- (Apr 30) yaml alias limit removed (PR #167)

**Ops / process model (Apr 10):**
- Process titles set for API, processor, scheduler — confirms **3-process split** in one repo, controlled by `INSTANCE_ROLE` env

**Hosts (Mar 28, on main):**
- `finalMask` property added — host can post-process rendered output (regex-replace at end). Combine with `hostOverrides` for layered customization.

**Misc:**
- (Apr 20) `tun` protocol as first-class inbound type (PR by Katze-942)
- (Mar 27) Cache keys for online users + node versions
- (Mar 26) `getAllTags` filters null tags + limits to 1000
- (Apr 11) `simplify traffic limit validation by removing integer constraint` — fractional bytes?

**Takeaways:**
- Hysteria2 generation in Clash family on their side too — Clash + Hysteria2 popular combo
- HWID race fix + numeric ID migration → high-volume HWID checks bottleneck on user lookup; **design with numeric IDs from day one** for device-tracking
- Process-title commit confirms 3-process pattern (API + processor + scheduler) discriminated by env. Worth mirroring or explicitly rejecting.

## Source files (key reads)

```
src/modules/internal-squads/internal-squad.service.ts
src/modules/external-squads/external-squads.service.ts
src/modules/external-squads/entities/external-squad.entity.ts
src/modules/external-squads/entities/external-squad-with-info.entity.ts
src/modules/hwid-user-devices/hwid-user-devices.service.ts
src/modules/subscription-template/render-templates.service.ts
src/modules/subscription-template/subscription-template.service.ts
src/modules/subscription-template/constants/default-templates.ts
src/modules/subscription-template/generators/{clash,mihomo,singbox,xray-json}.generator.service.ts
src/modules/subscription-response-rules/services/{response-rules-matcher,response-rules-parser}.service.ts
src/modules/subscription-response-rules/middleware/response-rules.middleware.ts
src/modules/node-plugins/{node-plugins,torrent-blocker-reports}.{service,controller}.ts
src/modules/infra-billing/infra-billing.{service,controller}.ts
src/modules/api-tokens/api-tokens.{service,controllers}.ts
src/modules/auth/strategies/jwt.strategy.ts
src/modules/auth/commands/sign-api-token/sign-api-token.handler.ts
src/modules/config-profiles/{snippets.service,snippets.controller,entities/snippet.entity}.ts
src/scheduler/intervals.ts
(subscription-page repo) backend/src/main.ts
```
