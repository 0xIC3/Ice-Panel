# Protocol Validation Status

What's actually validated by real traffic vs what's scaffolded. **Updated after every VPS-test cycle** — if a protocol moves from "code-only" to "real-traffic-verified", that's the change to make here.

> **Companion docs:** [ROADMAP.md](./ROADMAP.md) tracks slices; [TESTING.md](./TESTING.md) carries per-slice checklists; **this file** answers "what can I sell to a paying user today, vs what's still a science experiment".

> **Last updated:** 2026-05-08 (VPS cycle #3 — VLESS+REALITY+Vision **re-validated through Profile+Binding model end-to-end** on fresh `ice-panel-test 89.169.32.239` → `ice-xray-test 89.169.34.14`). Critical assertion: slice 27 refactor did not break the only paid-user-ready path. Bearer `icp_*` auth + mTLS + DeployProfileModal UI + cron healthcheck-degraded semantics + install-panel.sh PUBLIC_URL all verified on prod. New BullMQ foot-gun found and fixed: `removeOnFail: { age: 86400 }` on `apply-${nodeId}` jobId would lock the slot for 24h after a transient failure — replaced with `removeOnFail: true`.

## ✅ Confirmed by real traffic

The only one. Anything else listed below is some shade of "tested locally / loopback / VPS but not real-client".

### VLESS + REALITY + Vision (raw transport)

- **Slice:** 17, validated through 27 (Profile+Binding refactor)
- **Verified:** VPS test #1 (2026-05-06), #2 (2026-05-07), **#3 (2026-05-08 — through new Profile+Binding model)**
- **Clients confirmed:** Hiddify (iOS, Android), Streisand (iOS) — real browser traffic, not just connect-indicator
- **Per-user stats:** ✅ verified end-to-end on cycle #3 — `xray api statsquery -reset` → agent `/stats` → panel `node-stats-poll` cron (every 30s) → `user_traffic.used_traffic_bytes` + `node_usage_history` hourly → dashboard cards (UserPage shows 11.8 MiB / 100 GiB, node card shows traffic-of-the-hour, last-24h chart accumulates)
- **Status when shipping a paying user today:** safe
- **Cycle #3 confirms:** Profile created via UI (with REALITY keypair generated through new `/api/profiles/generate-keypair` endpoint) → DeployProfileModal binding to node → worker `inbound-sync` mTLS-pushed wire payload → agent rendered xray config (with realityPrivateKey field correctly deserialised) → xray.service started, listening on `:443` → subscription URL `/sub/<token>` returned valid `vless://...?security=reality&...` → client connected, real traffic. **No regression from slice 27.**

### VLESS + REALITY + xhttp (HTTP/2 chunked transport, no Vision)

- **Slice:** 24c part 2
- **Verified:** **VPS test #3 (2026-05-08)** — first real-traffic confirmation
- **Clients confirmed:** Hiddify — real browser traffic to telegram + apple endpoints, agent log shows `accepted tcp:... [vless-in >> direct] email: <userId>`
- **Path forward:** Vision is incompatible with non-raw transports — `flow` must be empty. Panel form lets admin pick `(none)` from Flow dropdown; agent stopped force-coercing empty→vision (was a defensive default, broke xhttp). xray uses `splithttp` listener under the hood (`listening TCP for XHTTP on 0.0.0.0:443`).
- **Status when shipping a paying user today:** safe (alongside REALITY+Vision-raw, now the second proven path)

This is the single protocol path you should default new commercial users to.

## ⚠️ Pipeline proven, real traffic NOT proven

Code is honest but unverified end-to-end against a real client. Don't promise to a paying user yet.

| Protocol | What's proven | Gap before sellable |
|---|---|---|
| **Hysteria2** | Loopback on VPS works (curl through local hy2 → example.com 200 OK ~4ms); auth callback verified; ACME cert issued | VPS-cycle #2: real client from RU mobile ISP gets `tx: 0` after handshake (DPI throttle, NOT a code bug). Need a different ISP/VPS pair OR `salamander` obfs OR port-hop config. |
| **AmneziaWG** | Adapter registered; `applyInbounds` reaches the node; kernel module installs; `awg syncconf` smart-diff classifier landed | No real awg-client connect ever. AmneziaVPN client install + verify on next VPS cycle. |
| **NaiveProxy** | Caddyfile render + `caddy reload` plumbing | Never run live. Need xcaddy build + real naive-client connect. |
| **Shadowsocks 2022** | Render config (with server PSK), URI builder, adapter wired through xray-core; SS2022/legacy AEAD ciphers in schema | Never run live. Outline / Shadowrocket / sing-box connect verify pending. |
| **MTProto** (`9seconds/mtg`) | Single-secret architecture verified against upstream; TOML render correct; URI both `tg://` and `https://t.me/proxy?...` forms | Never run live. Telegram client connect + Fake-TLS handshake against real masquerade domain pending. |
| **Mieru** (`enfein/mieru`) | JSON render verified against upstream operation.md; `mita apply config` + `reload` graceful; tracked-user bookkeeping | Never run live. mieru-client / sing-box connect pending. |

## 🟡 Code-complete but VPS-untouched

Slices that landed in this batch but haven't seen ANY VPS — even loopback.

| Slice | What | Why we're confident-ish |
|---|---|---|
| 24b3 | AWG smart-diff classifier (syncconf vs full restart) | Unit-tested; logic mirrors AmneziaWG upstream's documented behaviour. VPS test will catch real-world edge cases. |
| 24b4 | Naive ApplyInbound (Caddyfile rewrite + caddy reload) | Same — caddy reload is a known graceful operation; render verified by tests. |
| 24c part 1 | Xray per-user stats via `xray api statsquery -reset` | ✅ closed in cycle #3 (2026-05-08). Numbers flow xray → agent → panel cron → Prisma → dashboard under real traffic. Two bugs caught and fixed during this validation: (a) panel had no stats-poll cron registered (slice 24c rendered the xray-side machinery but didn't wire the panel-side puller — added `node-stats-poll` running every 30s); (b) Go agent's `xrayStatEntry.Value string` failed strict-mode unmarshal because xray-core 26.x emits `value` as a JSON number, not a string — switched to `json.Number` (accepts both). |
| 24c part 2 | Xray transports `httpupgrade` + `kcp` + routing defaults (sniffing/dns-out/blackhole/BLOCK rules + sockopt-BBR) | xhttp ✅ in cycle #3. `httpupgrade` / `kcp` / `ws` / `grpc` render shape verified against xray docs; client-side URIs round-trip. Per-network real connect pending next sub-cycle. |
| 24c part 3a | Trojan subprotocol over REALITY | Trojan inbound shape and URI scheme verified against XTLS docs. No live connect. |
| 26 | Squad ACL (groups CRUD + subscription filter) | Pure backend logic; integration tests work locally with sqlite-style stand-in. Production flow path has never been exercised end-to-end. |
| 24d | Shadowsocks 2022 — see ⚠️ table above | — |
| 40 | Mieru — see ⚠️ table above | — |
| 41 | MTProto — see ⚠️ table above | — |

## 🛑 Won't work without rework

| Protocol | Issue | Path forward |
|---|---|---|
| **MTProto multi-user** (real per-user accounting / per-user kick) | upstream `9seconds/mtg` rejects multi-secret model. Our impl is "one secret per inbound, all squad members share it" — works for the simple case but no per-user knobs | Either accept the limitation forever, or migrate to `dolonet/mtg-multi` fork (lags upstream security fixes) |
| **Hysteria2 on RU-mobile ISPs** | DPI throttle to `tx: 0` observed in VPS cycle #2 | Out-of-scope for code; depends on ISP / VPS provider / port choice. Document as "test on a non-restricted network first" in user docs. |

## Bugs caught during VPS cycles (cumulative)

- **Cycle #1 (2026-05-06):** 10 bugs.
- **Cycle #2 (2026-05-07):** 8 bugs + 3 upstream-mismatch (mtg secrets array, mieru YAML, SS2022 missing serverPSK).
- **Cycle #3 (2026-05-08):**
  1. **`install-panel.sh`: PUBLIC_URL invalid URL crash-loop.** Backend Zod `z.url().optional()` rejected empty string supplied by docker-compose `${PUBLIC_URL}` substitution. Fixed: install-panel writes `PUBLIC_URL` into `.env.production` from `PANEL_DOMAIN` / public IP; config schema additionally tolerates empty string.
  2. **TS `noUnusedLocals` killing prod build:** `Badge` import in SquadsPage and `GiB` constant in UsersPage left over after slice 27 cleanup. Fixed.
  3. **Cron healthcheck conflated `degraded` with `unreachable`.** Fresh node with no Profile+Binding pushed yet returns `{status: 'degraded'}` from agent (xray/ss have no config → not running) — but agent itself is reachable + healthy. Old cron flipped status to `unreachable`. Fixed: `degraded` → `online` with detail in `lastStatusMessage`.
  4. **`/api/inbounds/generate-keypair` 404** after slice 27 retired the inbounds module. Endpoint moved to `/api/profiles/generate-keypair`.
  5. **BullMQ `removeOnFail: { age: 86400 }` poisoned the apply-${nodeId} jobId for 24 hours** after a single transient failure (here: failed during initial install before backend stabilised). Coalescing logic (`jobId: apply-X`) treated the dead job as still owning the slot, silently dropping every subsequent enqueue from binding/profile events. Fixed: `removeOnFail: true` so failures vacate the slot immediately and the next event re-enqueues a fresh attempt.
  6. **xray adapter (Go) force-coerced empty Flow → `xtls-rprx-vision`** in two places (`adapter.go:addUser` and `config.go:withDefaults`). Was a defensive default for the old Inbound model — became a bug for xhttp/ws/grpc/kcp where Vision is incompatible. xray rejected every client with `account ... is rejected since the client flow is empty`. Mantine Select also returns `null` (not `""`) when the empty option is picked, so the panel-side Zod schema `flow: z.string()` 400'd; coerce `null → ""` and add an explicit `(none) — без flow` label so admins can see the option exists. Combined fix unblocked first ✅ for xhttp transport.
  7. **Stats pipeline gap** — slice 24c part 1 shipped the xray-side render (stats inbound, policy.levels, api-in dokodemo-door) but never wired the panel-side puller. Result: traffic counters stuck at 0 across dashboard / user page / node card / last-24h chart. Added `node-stats-poll` cron (every 30s) that calls `transport.getStats()` per online node and upserts deltas into `user_traffic.used_traffic_bytes` (× consumptionMultiplier) and `node_usage_history` hourly bucket.
  8. **Go agent statsquery JSON unmarshal silently dropping data.** `xrayStatEntry.Value string` paired with xray-core 26.x emitting `"value": <number>` (not `"<number>"`) caused `json.Unmarshal` to fail the entire batch — agent's `/stats` always returned zero counters even though `xray api statsquery -reset=false` over the loopback showed real bytes. Same bug in shadowsocks adapter (copy-paste of the same struct). Both switched to `json.Number` (accepts numeric and stringified). Surfaced only because the panel-side stats poller was finally wired up.

## What real-traffic verification needs (per protocol)

When you do another VPS cycle, this is the minimum to flip a protocol from ⚠️ to ✅:

1. **Bootstrap on a clean VPS** (not the same one xray runs on, to keep blast radius isolated)
2. **One real client** that targets that protocol (not just any "VPN client" — the right one)
3. **Open a real website in the browser** through the tunnel. Don't trust the client's connect-indicator alone — Streisand reported "connected" while traffic was going nowhere on cycle #2.
4. **Per-user stats arrive in the panel UI** for protocols that have them (xray, mieru — others don't expose user-level counters)
5. **One mutation while connected** — restart node-agent, change inbound config, swap user — and verify the client recovers gracefully or fails predictably

## Commercial-readiness focus

For the first 5–10 paying users, **default everyone to VLESS + REALITY + Vision (raw)**. Add other protocols to the panel UI but don't surface them in user-facing onboarding until they cross to ✅.

This isn't laziness — it's that one well-verified protocol is more valuable than five half-verified ones when there's a paying user yelling that "VPN is broken". You can debug one path; you can't debug five at once during a support call.

## How to update this doc

After every VPS test cycle:
1. Move any newly-verified protocol from ⚠️ to ✅
2. Add new entries for any new protocols added to the codebase
3. Bump the `Last updated` line at top
4. If a regression is caught, move from ✅ back to ⚠️ with a note explaining what broke

When committing the update, use a `docs(status):` scope — keeps the changelog clean and lets us answer "when did SS2022 actually start working" by `git log docs/PROTOCOL_STATUS.md`.
