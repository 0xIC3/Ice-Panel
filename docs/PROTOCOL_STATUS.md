# Protocol Validation Status

What's actually validated by real traffic vs what's scaffolded. **Updated after every VPS-test cycle** — if a protocol moves from "code-only" to "real-traffic-verified", that's the change to make here.

> **Companion docs:** [ROADMAP.md](./ROADMAP.md) tracks slices; [TESTING.md](./TESTING.md) carries per-slice checklists; **this file** answers "what can I sell to a paying user today, vs what's still a science experiment".

> **Last updated:** 2026-05-13 EOD (**VPS cycle #8** — Phase 3 closed end-to-end on 5 protocols in a single marathon). **AmneziaWG** on iPhone (AmneziaVPN 4.8.15.4 → Aeza Helsinki, 21 GiB through tunnel including iPhone background sync). **MTProto** on Telegram iOS → Aeza Sweden mtg, Fake-TLS `www.bing.com`. **NaiveProxy** via official `naive.exe` CLI on Windows → Aeza Sweden Caddy+forwardproxy, real LE cert via HTTP-01, Variant1 padding negotiated. **14 cycle #8 bugs** caught + fixed live (AWG NAT direction + UFW forward policy + /run ReadWritePaths, MTProto 16-byte secret + mtg-Prometheus integration + panel-cron node-totals fallback, AWG per-user stats wiring + S3/S4 client #2582 workaround, Naive registration miss + xcaddy `@caddy2` suffix + deferred-start + probe_resistance edge + Caddy storage path + bootstrap-command flag mismatch). See cycle entries below + TROUBLESHOOTING.md for the numbered list.

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
- **Verified:** VPS cycle #3 (2026-05-08), **re-confirmed cycle #5 (2026-05-10)** through new recipe library
- **Clients confirmed:** Hiddify — real browser traffic
- **Status when shipping a paying user today:** safe

### VLESS + REALITY + gRPC

- **Slice:** 24c part 2
- **Verified:** **VPS cycle #5 (2026-05-10)** via Hiddify
- **Status:** safe

### Trojan + REALITY (raw)

- **Slice:** 24c part 3a
- **Verified:** **VPS cycle #5 (2026-05-10)** via Hiddify
- **Status:** safe (password-auth instead of UUID, anti-probe parity with VLESS)

### Hysteria 2 + Salamander obfuscation + Port-hopping (slice 31.5)

- **Slice:** 11 (core), 24b2 (ApplyInbound), 31.5 (port-hopping shipped cycle #6)
- **Pipeline verified:** cycle #5 (2026-05-10) on Beget SE 147.45.76.143
- **RU client end-to-end:** ✅ **CONFIRMED CYCLE #6 (2026-05-12)** on Aeza London (85.192.38.176) via **Hiddify Next** (sing-box) — 9 MB+ traffic flowed cleanly through tunnel, ifconfig.me returned server IP, YouTube streamed.
- **Per-user traffic counters:** ✅ **shipped cycle #6** — Hysteria's `/traffic` API endpoint (loopback :9999, secret-protected) polled every 30s, parsed JSON → `core.UserStats{BytesIn,BytesOut}`. UI Nodes page shows real bytes (was stuck on `0 B today` pre-cycle-6 because `GetStats()` was a TODO).
- **Port-hopping (slice 31.5):** URI emits `mport=20000-50000`, sing-box outbound `server_ports`, Clash `ports`; install-node.sh applies `iptables -t nat -A PREROUTING -p udp --dport 20000:50000 -j REDIRECT --to-ports 443` via dedicated `ice-panel-hyhop.service` systemd unit (oneshot+RemainAfterExit, ExecStop removes the rule, auto-restore on boot).
- **Client compatibility (cycle #6 findings):**
  - **Hiddify Next** (desktop + iOS, sing-box-based): ✅ works flawlessly with our `obfs=salamander&mport=20000-50000&upmbps=100&downmbps=100` URI shape
  - **Happ iOS** (Xray-core hysteria2 outbound): ❌ auth passes, streams open then get `canceled by remote with error code 0`. Xray-core's hysteria2 outbound mis-negotiates Brutal CC + port-hopping combo. **Not our bug** — track as Happ-side. Recommendation: prefer Hiddify Next for Hysteria 2 on iOS.
- **What we proved cycle #6:** panel↔node pipeline correct (config render, ApplyInbound, addUser, auth callback), `ignoreClientBandwidth: true` defaults, per-install random `HYSTERIA_STATS_SECRET`, separate `panelClient` mTLS cert, port:8443 UFW lockdown, port-hopping iptables NAT applies cleanly, real `/traffic` API gives per-user bytes back to panel UI.
- **Hosting note (cycle #6):** Aeza London ↔ RU mobile carrier route is clean for QUIC UDP/443 in both directions (proven by 73ms ping + multi-MB traffic). Cycle #5's "RU iOS not working" was specifically about Beget SE route — different hosting, different result. Pick your hosting carefully.
- **Lifecycle model:** systemd-managed `hysteria.service` (install-node.sh wrote the unit). Agent's adapter respects `HYSTERIA_SERVICE_UNIT=hysteria` and only writes config + reloads via `systemctl restart` on ApplyInbound — NEVER spawns its own subprocess (would compete for :443/udp). `hysteria-server.service` (the unit `get.hy2.sh` ships) is auto-disabled by install-node.sh to prevent config races.
- **Status when shipping a paying user today:**
  - **Desktop (any OS) via Hiddify Next:** ✅ safe — verified end-to-end cycle #6
  - **iOS via Hiddify Next:** ✅ safe — sing-box implementation handles our config
  - **iOS via Happ:** ⚠ broken (Happ's Xray-core hysteria2 incompat) — document this in user-facing onboarding
  - **CLI hysteria client:** ✅ safe (server-side smoke proven)

### Multi-protocol multi-node fan-out

- **Verified:** **VPS cycle #5 (2026-05-10)** — single user gets both vless + hy2 endpoints in their subscription, Hiddify shows two profile entries, switches cleanly between cores
- **What it proves:** profile + binding + host model (slice 27/30) actually works under real traffic with two independent VPS hosting two different cores. End-to-end multi-node ops.

### AmneziaWG (kernel module + obfuscation)

- **Slice:** 19 (core), 23 (presets + form), 24b3 (smart-diff classifier), 27 (Profile+Binding wiring)
- **Verified end-to-end:** **VPS cycle #8 (2026-05-13)** on Aeza Helsinki (Debian 12 / kernel 6.1.0-47 / amneziawg DKMS v1.0.20251009). iPhone iOS 26.4 + AmneziaVPN 4.8.15.4. **25 MB of real YouTube traffic** flowed through tunnel; `awg show awg0 transfer` reported matching RX/TX growth on server.
- **Per-user stats:** ✅ shipped cycle #8. `GetStats()` parses `awg show <iface> dump` (kernel-cumulative bytes, peer pubkey → userID via tracked peers map), panel `node-stats-poll` cron picks it up, "Сегодня" column on Nodes page shows live MiB.
- **Operational gotchas locked in (cycle #7 + #8 lessons):**
  - **Subnet:** `10.0.0.0/24` collides with Aeza host gateway (`10.0.0.1`) — VPS loses connectivity minutes after tunnel up. Default changed to `10.66.66.0/24`.
  - **Port:** RU mobile carriers DPI-drop UDP/443 outbound. We open both 443 and 1234 in UFW; admin sets the binding port in the panel UI. Don't use 51820 (well-known WG default; DPI targets it specifically).
  - **Client version:** AmneziaVPN ≥ 4.8.12.9 or Hiddify Next ≥ 2.4. Older clients silently fail.
  - **Upstream client bug [#2582](https://github.com/amnezia-vpn/amnezia-client/issues/2582)** — AmneziaVPN 4.8.12.9 → 4.8.15.5 silently drops traffic when server has non-zero S3 or S4. Our TSPU / Mobile / Iran presets all default `S3=0 S4=0` until upstream ships a fix.
  - **`iptables MASQUERADE` direction:** awg-quick's default template uses `-o %i` (interface itself = traffic to peers — wrong direction). Our agent's default PostUp uses `! -o %i` (any iface EXCEPT awg — i.e. WAN egress). Without this, handshake completes but responses never NAT back to clients.
  - **UFW `DEFAULT_FORWARD_POLICY=DROP`:** routed VPN needs ACCEPT. install-node.sh flips it in the `amneziawg)` branch.
  - **systemd unit `/run` sandbox:** ufw + netfilter-persistent both need `/run/*.lock` writable. `ReadWritePaths=-/run -/etc/iptables` added.

### MTProto (Telegram-only via `9seconds/mtg` Fake-TLS)

- **Slice:** 41 (core + URI), 24b4-equivalent (ApplyInbound wiring)
- **Verified end-to-end:** **VPS cycle #8 (2026-05-13)** on Aeza Sweden, Telegram iOS, masquerade `www.bing.com`. Connect → real Telegram messaging traffic flows.
- **Architecture note:** mtg is intentionally single-secret upstream — one mtg instance = one secret. We derive deterministically from `(inboundId, domain)` so panel + agent independently compute the same value. Every user in the inbound's squad receives the same URL. No per-user accounting available (architectural ceiling of upstream; documented as ⚠️ in "Won't work without rework" below).
- **Node-wide traffic accounting:** `GetStats()` scrapes mtg's Prometheus endpoint at `127.0.0.1:3129/metrics`, sums `mtg_telegram_traffic{direction="from_client"|"to_client"}` across all `(dc, telegram_ip)` label combinations. Panel-cron's `stats.cron` falls back to `TotalBytesIn/Out` when per-user counters sum to zero, using an in-memory `totalSnapshot` map to compute deltas tick-to-tick. `mtg_domain_fronting_traffic` is deliberately ignored (SNI probe camouflage, not user traffic).
- **Spec compliance:** FakeTLS secret is `ee` + **16 random bytes** + hex-encoded SNI domain. Caught cycle #8: we'd been emitting 32 random bytes (the whole sha256 digest), Telegram rejected with "Invalid proxy link" / "Некорректная ссылка на прокси". Now sliced to `[:16]` in both panel and agent.

### NaiveProxy (Caddy + `klzgrad/forwardproxy@naive`)

- **Slice:** 20 (core), 24b4-equivalent (ApplyInbound wiring), cycle #8 closure
- **Verified end-to-end:** **VPS cycle #8 (2026-05-13)** on Aeza Sweden, Windows `naive.exe` client → `https://ice-naive-test.icepath.tech:443` → ifconfig.me. Logs confirm Preamble probe-resist exchange + Variant1 padding negotiation, returning 200 OK with Caddy server header.
- **Real cert flow:** ACME HTTP-01 via Let's Encrypt acme-v02; account auto-registered with `TLSEmail` from the Profile; cert stored at `/etc/caddy/...` (overridden via `storage file_system` global directive — see lessons below).
- **Architecture: Caddy + forward_proxy + file_server in one route.** Users in the inbound's squad → `forward_proxy` block with `basic_auth username password`. No squad users → block omitted, site is pure `file_server` masquerade looking like a vanilla static-content host on probes. First `AddUser` triggers reload that adds the `forward_proxy` block atomically.
- **Operational gotchas locked in (cycle #8):**
  - **xcaddy `--with` replacement target needs `@caddy2` suffix.** `github.com/caddyserver/forwardproxy@caddy2=github.com/klzgrad/forwardproxy@naive`. Without it the build succeeds but `forward_proxy` module doesn't register; runtime fails silently.
  - **Use `@naive` branch, not `v2.x` tags.** klzgrad/forwardproxy doesn't follow Go modules' `/v2` path convention, so `go mod edit -replace ...v2.10.0-naive` errors out. Branch reference resolves to a pseudo-version that bypasses semver strict-mode.
  - **`Start()` defers when Hostname unset.** install-time bootstrap registers the adapter with empty Inbound; panel pushes hostname via applyInbound. Without deferring, `render Caddyfile: Hostname is required` crash-loops under systemd.
  - **`regenerateAndReloadLocked` cold-starts caddy on first apply** (proc == nil) instead of `caddy reload` (which needs a running admin endpoint).
  - **`probe_resistance` needs at least one `basic_auth`.** Skip the whole `forward_proxy` block when user list empty.
  - **Pin Caddy storage to `/etc/caddy`** via global options block — the default `./caddy` fallback hits "Read-only file system" under `ProtectSystem=strict` with no HOME.
  - **No install-time flags.** Hostname/email live on the Profile. Earlier panel-side bootstrap-command builder emitted `--naive-domain` / `--naive-email` (Hysteria-pattern carry-over) that install-node.sh doesn't parse; removed in both `nodes.service.ts` and `nodes.routes.ts`.
- **Client recommendations:**
  - **`naive.exe`** (official klzgrad CLI) — primary, prod-grade. Listens on localhost SOCKS5+HTTP, browser uses via proxy-aware extension or system settings.
  - **NekoBox / NekoRay** — sing-box-based, native naive support.
  - **Hiddify Next** — accepts naive only via subscription (not manual paste in 4.1.1). singbox JSON deliberately omits naive (no native sing-box outbound type), so the subscription generator skips it in the singbox format; admins surface the `naive+https://` URI directly in the user-edit modal.

The four xray transports + Hysteria + **AmneziaWG + MTProto + NaiveProxy** are the **default safe set** for new commercial users today.

## ⚠️ Pipeline proven, real traffic NOT proven

Code is honest but unverified end-to-end against a real client. Don't promise to a paying user yet.

| Protocol | What's proven | Gap before sellable |
|---|---|---|
| **Shadowsocks 2022** | Render config (with server PSK), URI builder, adapter wired through xray-core; SS2022/legacy AEAD ciphers in schema. Included in the singbox JSON subscription, so Hiddify Next probably already imports it on existing nodes. | Never explicitly connect-tested. Outline / Shadowrocket / sing-box connect verify pending — likely a 10-min probe at this point. |
| **Mieru** (`enfein/mieru`) | JSON render verified against upstream operation.md; `mita apply config` + `reload` graceful; tracked-user bookkeeping | Never run live. mieru-client / sing-box connect pending. Needs a fresh node spin-up. |

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
- **Cycle #7 + #8 (2026-05-13) — Phase 3 close.** AmneziaWG end-to-end on iPhone (25 MB tunneled) and MTProto end-to-end on Telegram iOS. 8 cross-layer bugs closed during the marathon:
  1. **AWG MASQUERADE direction.** Default PostUp template was `iptables -t nat -A POSTROUTING -o %i -j MASQUERADE` — `-o %i` matches packets exiting on the wg interface itself (= traffic TO peers, wrong direction). Fixed to `! -o %i` (any iface EXCEPT wg = real WAN egress). Without this, AWG handshake completed but VPN clients had 25 KiB RX / 348 B TX because responses never got NATted back. `config.go` default updated; old installations need a manual `iptables -t nat -D POSTROUTING -o awg0 -j MASQUERADE; iptables -t nat -A POSTROUTING -s <subnet> ! -o awg0 -j MASQUERADE`.
  2. **UFW `DEFAULT_FORWARD_POLICY=DROP` silently broke AWG.** Forwarded packets between awg0 and WAN got reject'd in the FORWARD chain. install-node.sh now flips it to ACCEPT in the `amneziawg)` branch (+ `ufw default allow routed`).
  3. **systemd unit `/run` read-only crashed ufw + netfilter-persistent inside agent.** `ProtectSystem=strict` plus a `ReadWritePaths=` whitelist that omitted `/run` meant ufw could not write `/run/ufw.lock` — `firewall.Allow()` silent-no-op'd on every applyInbound. Added `-/run -/etc/iptables` to `ReadWritePaths=`.
  4. **AmneziaWG per-user traffic stats wired up.** `GetStats()` was a stub returning zero counters. Now parses `awg show <iface> dump` TSV (peer pubkey → rx/tx bytes), maps to userID via tracked `peers` map. Falls back to zero counters on `awg show` failure rather than erroring the stats poll. Result: "Сегодня" column on Nodes page shows live MiB on AWG.
  5. **AmneziaVPN client bug [#2582](https://github.com/amnezia-vpn/amnezia-client/issues/2582).** Versions 4.8.12.9 → 4.8.15.5 silently drop traffic when server has non-zero `S3` or `S4`. All three AWG presets (TSPU / Mobile / Iran) now default `S3=0 S4=0`. Schema still allows non-zero so admins can flip when upstream ships a fix.
  6. **RU mobile carriers DPI-drop UDP/443 outbound.** Mid-tunnel tcpdump on awg-VPS showed zero incoming packets despite client showing "Sending handshake initiation" every 5s. UFW pre-opens 443 AND 1234 UDP for amneziawg; admin picks the binding port in panel UI. 1234 (or any high random < 9999) bypasses the filter. Documented in install-node.sh `amneziawg)` ufw block.
  7. **MTProto FakeTLS secret was 32 bytes — Telegram rejected with "Invalid proxy link".** Spec mandates exactly 16 random bytes after the `ee` prefix; longer secrets fail client-side validation. Sliced sha256 digest to `[:16]` in both `panel-backend/src/core-adapters/mtproto/uri.ts` (`mtprotoSecret`) and `node/internal/core/mtproto/config.go` (`DeriveSecret`) so both still compute the same value for `(inboundId, domain)`.
  8. **AmneziaWG default subnet via withDefaults() overrode legitimate zero values.** Slice 19's withDefaults() hard-coded `Address = 10.0.0.1/24` / `Jc = 4` / `S1-S4 = 72, 56, 32, 16` so when admin explicitly set anything to zero in the UI, the agent rewrote it to the default. Same code was responsible for the Aeza-collision incident. Removed all withDefaults overrides for Address/Jc/Jmin/Jmax/S1-S4 — zero on the wire now means zero. Caught and fixed cycle #6 but verified end-to-end in cycle #8 with `Jc=0`.
  9. **MTProto node-wide stats via mtg Prometheus scrape.** `GetStats()` previously returned tracked users with zero counters (per-user accounting architecturally impossible for single-secret mtg). Now HTTP-GETs `127.0.0.1:3129/metrics`, parses Prometheus text format, sums `mtg_telegram_traffic{direction="from_client"|"to_client"}` across all `(dc, telegram_ip)` label combinations. `mtg_domain_fronting_traffic` is deliberately ignored (SNI probe camouflage). Falls back to zero on scrape failure rather than failing the whole poll.
  10. **panel-cron stats.cron ignored `Stats.TotalBytesIn/Out`.** Only summed `res.users[].bytesIn/bytesOut` for the node-level `nodeUsageHistory` upsert — always 0 for mtproto. Added module-scope `totalSnapshot: Map<nodeId, {in, out}>` to record previous cumulative values per node (mtg counters are monotonic) so we compute deltas tick-to-tick instead of double-counting. Removed early-return on `users.length === 0` so adapters without tracked users still get their totals processed.
  11. **Naive adapter not registered in `main.go`.** Slice 20 code shipped but never wired into the adapter registry, so `applyInbounds` for naive landed with `no adapter for protocol — config persisted but not applied live`. Caddyfile got written to disk but Caddy was never spawned, so `:443/tcp` had nothing listening. Same bug class as the AWG miss caught in cycle #6. Added explicit registration block: probe for `/usr/local/bin/caddy-naive` (the binary `bootstrap-naive.sh` builds), register on present.
  12. **panel-backend emitted `--naive-domain` / `--naive-email`** in the bootstrap-command builder (Hysteria-pattern carry-over) that `install-node.sh` doesn't accept. Fresh installs errored with `[fail] Unknown arg: --naive-domain`. Removed both blocks in `nodes.service.ts` and `nodes.routes.ts`. Hysteria is the only protocol that takes install-time ACME flags — its `get.hy2.sh` service starts before the panel can push config (chicken-and-egg). Naive/SS2022/MTProto/Mieru all start idle and wait for the panel's first applyInbound.
  13. **xcaddy `--with` needed `@caddy2` suffix on the replacement target.** `github.com/caddyserver/forwardproxy@caddy2=github.com/klzgrad/forwardproxy@naive` is the correct invocation. Without the `@caddy2` suffix, xcaddy produces a binary that lacks the `http.handlers.forward_proxy` module — build succeeds, runtime fails silently. First Aeza build linked it by luck of Go module resolution; the uninstall/reinstall second build resolved differently and the missing suffix surfaced. Also pinned to `@naive` branch (not `v2.x` tag — Go semver rejects v2-prefixed tags without `/v2` path).
  14. **Naive `Start()` crashed on empty Hostname.** Default `InboundConfig` arrives empty (panel pushes hostname via applyInbound), but `Start()` tried to render Caddyfile immediately and hit `Hostname is required (Caddy needs it for ACME)`. Crash-looped under systemd `Restart=always`, applyInbound never reached the adapter. Fixed by deferring spawn when Hostname is unset — same pattern as mtproto/amneziawg adapters. `regenerateAndReloadLocked` now cold-starts caddy on first apply (`proc == nil`) instead of trying to `caddy reload` a non-running daemon.
  15. **Naive Caddyfile with `probe_resistance` + zero `basic_auth` lines** failed Caddy validation (`provision http.handlers.forward_proxy: probe resistance requires authentication`). Emit `forward_proxy` block only when user list is non-empty — pre-user the site is pure `file_server` masquerade (which is what probes should see anyway). First `AddUser` triggers a regenerate+reload that adds the block.
  16. **Caddy storage default `./caddy`** hit `mkdir caddy: read-only file system` because `ProtectSystem=strict` + no HOME set in systemd unit. Caddy tried `$XDG_DATA_HOME/caddy`, then `$HOME/.local/share/caddy`, then `./caddy` — only the last one was attempted (HOME/XDG both empty), and cwd is `/`. Site bound to `:443` but ACME never persisted a cert. Pinned via global options block `{ storage file_system /etc/caddy }` in the rendered Caddyfile (`/etc/caddy` is already in `ReadWritePaths=`).
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
