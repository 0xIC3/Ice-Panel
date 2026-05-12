# Troubleshooting

Knowledge accumulated in production. When you hit one of these symptoms, the
fix is here — don't re-debug it from scratch.

## Cycle marker

Last updated: 2026-05-12 EOD (cycle #6 reality-check on fresh Aeza fleet — 21
live bugs caught + fixed end-to-end: London Hysteria, Helsinki Xray, AmneziaWG
node-side fully working, AmneziaWG client-side handshake still pending).

## Cycle #6 EOD summary

Reality-checked from-scratch install end-to-end on freshly-imaged Aeza VPS:
- panel install via single `bash <(curl ...)` command
- Xray REALITY all 4 transports (raw / xhttp / gRPC / Trojan)
- Hysteria 2 clean + Salamander obfs + port-hopping (slice 31.5)
- Slice 38 self-destruct (T+3 min exit 42, RestartPreventExitStatus stops
  systemd from reviving)
- Slice 38 auto-resync (T+1 sec applyInbounds re-issue after agent restart)
- Hysteria traffic counters via /traffic API
- Tier-1 honeypot trap + honey-user tripwire + per-IP rate-limit +
  username lockout

12 live-only bugs found that no unit test had caught (each cross-cuts
layers — backend code + nginx + docker-compose env passthrough + Bash
script + Go agent — exactly the seams unit tests don't span):
1. pgcrypto migration crashloop (DO $$ pattern)
2. ACME_DEFAULT_EMAIL='' rejected by Zod
3. get.hy2.sh placeholder config race
4. install-node.sh /healthz self-check (curl without client cert after S6)
5. Shadowsocks GetStats noise on non-SS nodes
6. HTTP_CODE concat "410000" in bootstrap fetch
7. Interactive `read -rp` swallowing Cyrillic+backspace input
8. Recipe Math.random() evaluating once at module-load
9. Hysteria traffic stats TODO returning zero bytes
10. Honeypot paths never reached backend (frontend nginx ate them)
11. HONEY_USER_TOKENS not passthrough'd in docker-compose.prod.yml
12. @fastify/rate-limit error{statusCode:429} returned 500 instead of 429
13. AmneziaWG adapter not registered in main.go (slice 19 code shipped but unwired)
14. AmneziaWG Start() crashloop when panel hasn't pushed config yet (PrivateKey="")
15. AmneziaWG configs written to /etc/amneziawg/ but upstream awg-quick expects /etc/amnezia/amneziawg/
16. inbound-sync worker pushed amneziawgPublicKey but never the allocated peer IP — silent peer-skip on node
17. AmneziaWG default subnet 10.0.0.0/24 collides with Aeza's internal gateway 10.0.0.1 — VPS loses connectivity minutes after awg0 comes up, no kernel panic, no oops. Reported by Aeza support on ticket #604280 after 4 burned VPS attempts. Default changed to 10.66.66.0/24.
18. AmneziaWG inbound port not propagated through wire — agent always bound to install-time fallback (51820) while wgconf advertised whatever the admin set in UI (typically :443). Handshake init dropped on closed socket. Fix: panel-backend now injects `listenPort` into wire config, agent's `inboundCfgWire.ListenPort` field reads it.
19. AmneziaWG Jc/Jmin/Jmax/S1-S4 changes via `awg syncconf` silently no-op on the upstream fork — junk/magic-size fields are interface-init-time-only. classifyDiff used to return diffSyncconf for those; now they fall into diffRestart (awg-quick down/up) and actually take effect.
20. AmneziaWG `renderConfig.withDefaults()` overwrote legitimate zero values with TSPU presets (Jc=4, Jmin=40, Jmax=70, S1=72, S2=56, S3=32, S4=16) AND Address=10.0.0.1/24. Made it impossible to disable obfuscation from the panel UI for debugging, AND silently re-introduced the Aeza-subnet collision when admin left Address unset. Removed those defaults — panel always sends explicit values via AmneziawgConfigSchema.
21. UFW only opened UDP/51820 (WireGuard default) at install time for `--protocol amneziawg`; operators picking the more common :443 stealth port in UI got handshake timeouts because the firewall dropped every packet. install-node.sh now opens both.

## Panel side

### Caddy 502 to frontend after backend restart

**Symptom:** UI says "502 Bad Gateway" right after `bash scripts/deploy.sh` or
any backend container restart. `docker compose ps` shows backend healthy.

**Why:** nginx-frontend resolves the `backend:3000` upstream once at startup
via `gethostbyname()` and caches the IP forever. Docker assigns a new IP to
the rebuilt backend container; nginx still tries the old address.

**Permanent fix shipped:** `apps/panel-frontend/nginx.conf` uses
`resolver 127.0.0.11 valid=10s ipv6=off` + `set $backend ...` in proxy_pass —
runtime DNS, refreshes every 10s. If you see this on an OLDER deploy:
`docker compose -f docker-compose.prod.yml restart frontend`.

### Prisma migration marked applied but column missing

**Symptom:** `prisma:error column "X" does not exist` even though the matching
migration shows in `_prisma_migrations` table.

**Why:** A migration with a `DO $$ … $$` block that conditionally runs SQL
based on extension availability can fail silently within a transaction —
Prisma marks the migration done from its checkpoint logic but the schema
change never landed.

**Recovery:**
```sql
-- Add column manually + set defaults if needed
ALTER TABLE "X" ADD COLUMN IF NOT EXISTS "Y" <type>;
-- Then mark migration finished if it's stuck "in progress":
UPDATE _prisma_migrations
SET finished_at = NOW(), applied_steps_count = 1, rolled_back_at = NULL, logs = NULL
WHERE migration_name = '<your_migration>' AND finished_at IS NULL;
```

**Future prevention:** in migrations needing pgcrypto / pgvector / etc, use
unconditional `CREATE EXTENSION IF NOT EXISTS X;` at the top, then plain SQL.
Avoid `DO $$ IF EXISTS pg_extension ... $$` patterns.

### Local changes on VPS block `git pull`

**Symptom:** `error: Your local changes to the following files would be
overwritten by merge: scripts/...`. `git diff` shows empty diff.

**Why:** Filemode (executable bit) drift between Windows commits and Linux
checkout. Empty `git diff` + non-empty `git status` is the diagnostic
fingerprint.

**One-time fix:**
```bash
git config core.fileMode false
git checkout scripts/
git pull
```

### `docker compose run --rm migrate` fails with "Can't reach database"

**Symptom:** Migration hangs on `dial tcp postgres:5432`. Postgres container
is healthy.

**Why:** Some compose backends — notably podman's docker shim — don't attach
ad-hoc `run --rm` containers to the project network reliably.

**Fix:** Replace with `up --abort-on-container-exit migrate`. `deploy.sh` and
`deploy-backend.sh` already use this pattern.

### 5xx after deploy though container is up

**Symptom:** Backend container `Up (healthy)` but UI returns 500. Logs show
no incoming requests for the failing path.

**Why:** Frontend nginx still has the old image's static bundle. Vite builds
content-hashed assets but the COPY layer in Docker can occasionally cache
hit on a stale dist/.

**Fix:** Deploy scripts default to `--no-cache` since cycle #5. If you opt
out via `--cache` and hit this, run `bash scripts/deploy-frontend.sh`
(no flag = no-cache).

### Backend crashloops with `Invalid environment configuration: ACME_DEFAULT_EMAIL`

**Symptom:** Backend container restarts every few seconds, log shows
`❌ Invalid environment configuration: ACME_DEFAULT_EMAIL: Invalid email address`
even though `.env.production` has the line present.

**Why:** `install-panel.sh` (pre-cycle-6) emitted a literal `ACME_DEFAULT_EMAIL=`
empty-string line into the generated env file as a "fill me in later" hint.
Zod's `.email().optional()` rejected `''` as invalid because empty-string ≠
absent. Same pattern other env vars dodged via `.transform(v => v === '' ? undefined : v)`.

**Permanent fix shipped (commit ff6af48):** config.ts now preprocesses `''` →
`undefined` before the `.email()` check.

**One-shot recovery on older deploys:**
```bash
# Replace empty with a real address
sed -i 's|^ACME_DEFAULT_EMAIL=$|ACME_DEFAULT_EMAIL=admin@example.com|' /opt/ice-panel/.env.production
# OR remove the line entirely
sed -i '/^ACME_DEFAULT_EMAIL=$/d' /opt/ice-panel/.env.production
# Re-create backend (recreate, not restart — restart doesn't reload env-file)
cd /opt/ice-panel && docker compose -f docker-compose.prod.yml \
  --env-file .env.production up -d --force-recreate backend
```

### Honeypot trap `/.env` returns 200 + SPA HTML instead of 404 fake

**Symptom:** `curl https://panel.example.com/.env` returns HTTP 200 with the
SPA's `index.html` body instead of the honeypot's fake `<html>Not Found</html>`.
IP doesn't get blacklisted, no Telegram alert, no `ice_panel_honeypot_hits_total`
increment.

**Why:** Backend's `security-gate` middleware (Tier-1 honeypot) only runs on
requests that REACH the backend. Frontend nginx (`apps/panel-frontend/nginx.conf`)
proxies `/api/`, `/sub/`, `/health`, `/admin/` to backend but **everything
else falls through to the SPA `try_files` rule** — including `/.env`,
`/wp-admin`, `/xmlrpc.php`. Scanner sees a perfectly normal SPA shell.

**Permanent fix shipped (cycle #6):** frontend nginx now has an explicit
regex location matching known scanner paths and proxies them to backend so
the trap can fire:
```nginx
location ~* ^/(\.env(\b|$)|\.git/|\.aws/|wp-admin|wp-login|wp-config\.php|xmlrpc\.php|phpinfo\.php|server-status|phpmyadmin|wordpress) {
    proxy_pass http://$backend;
    ...
}
```

**Recovery on older deploys:** `bash scripts/deploy-frontend.sh` after
`git pull`. The pattern is in `nginx.conf`; rebuilt frontend image picks it up.

### `HONEY_USER_TOKENS` set in `.env` but `printenv` inside backend container shows empty

**Symptom:** Honey-user tripwire never fires. `/sub/<canary>` returns 404
NOT_FOUND from regular subscription handler instead of plausible-empty 200 +
IP blacklist. `grep HONEY_USER_TOKENS /opt/ice-panel/.env.production` shows
the value present.

**Why:** Every new env var added to `config.ts` ALSO needs an entry in
`docker-compose.prod.yml` under `backend.environment:`. Docker Compose
doesn't auto-forward arbitrary keys from `.env-file` into containers — only
those explicitly declared. Caught live cycle #6 on cross-layer sync gap:
config schema ✅, .env template ✅, route handler ✅, but compose
passthrough was missing for `HONEY_USER_TOKENS`.

**Permanent fix shipped:** `HONEY_USER_TOKENS: ${HONEY_USER_TOKENS:-}` added
to `docker-compose.prod.yml`.

**Verify env reaches container:**
```bash
docker compose -f /opt/ice-panel/docker-compose.prod.yml \
  --env-file /opt/ice-panel/.env.production exec backend printenv HONEY_USER_TOKENS
```
Empty output = compose passthrough is missing → add line, `up -d backend`.

### `/api/auth/login` returns HTTP 500 with Retry-After + X-RateLimit headers

**Symptom:** Sixth or higher login attempt within a minute returns HTTP 500
but the response carries `retry-after: 59` + `x-ratelimit-limit: 5` + similar
plugin headers. Backend logs show `"msg":"Unhandled error","err":{"type":
"Error","message":"Rate limit exceeded, retry in 59 seconds","statusCode":429}`.

**Why:** `@fastify/rate-limit` v10 throws `Error{statusCode:429}` instead of
calling `reply.code(429).send(...)` directly. The thrown error bubbles up to
`app.setErrorHandler`, which (pre-cycle-6) didn't check `error.statusCode`
and treated it as a generic "Unhandled error" → returned 500. The rate-limit
plugin had already set its headers on the reply object before throwing, so
the client saw the headers but the wrong status.

**Permanent fix shipped (cycle #6):** `setErrorHandler` now honors any 4xx
`statusCode` on the error object, returning the correct status with a
clean JSON body (`{"error":"RATE_LIMITED","message":"..."}` for 429).

### Hysteria node shows `0 B today` in panel UI despite active traffic

**Symptom:** UI Nodes page shows `0 B` traffic for a Hysteria node even when
clients are actively tunneling MB+ through it. Other protocol nodes (Xray)
show real bytes on the same panel.

**Why:** `apps/node/internal/core/hysteria/adapter.go` `GetStats()` was a
TODO stub (slice 13 placeholder) returning the user-id list with zero
counters. Unlike Xray (which exposes stats via `xray api statsquery` gRPC),
Hysteria-server keeps per-user uplink/downlink behind a separate
`trafficStats:` HTTP API that the adapter never polled.

**Permanent fix shipped (cycle #6):**
- `install-node.sh` generates `HYSTERIA_STATS_SECRET=$(openssl rand -hex 24)`
  at install time and writes it to `/etc/ice-panel-node/env`.
- Initial `/etc/hysteria/config.yaml` includes the `trafficStats:` block
  bound to `127.0.0.1:9999` (loopback-only, secret-protected).
- `GetStats()` now polls `http://127.0.0.1:9999/traffic?clear=1` with the
  matching secret as Authorization bearer, parses the JSON map keyed by
  user-id (the one we returned from `/auth` callback), and fills
  `core.UserStats{BytesIn, BytesOut}`.
- Soft-fails on every error: temporary stats outage doesn't break the cron
  poller for other adapters on the same node.

**Verify on older nodes:**
```bash
# Hysteria binding the endpoint?
ss -ltnp | grep 9999
# Endpoint responds with the matching secret?
SECRET=$(grep ^HYSTERIA_STATS_SECRET /etc/ice-panel-node/env | cut -d= -f2)
curl -sH "Authorization: $SECRET" http://127.0.0.1:9999/traffic | head
```
Missing 9999 listener → `--reset` reinstall with current install-node.sh.

## Node side

### Hysteria FATAL "address already in use" right after install

**Symptom:** `journalctl -u ice-panel-node` shows
`hysteria subprocess started → FATAL listen udp :443: bind: address already
in use`. Standalone `hysteria.service` is also Up.

**Why:** install-node.sh creates a systemd-managed `hysteria.service`. The
agent's adapter ALSO tried to spawn an in-process hysteria subprocess. Both
fight for the same `:443/udp` socket.

**Permanent fix shipped:** `apps/node/internal/core/hysteria/adapter.go:Start()`
respects `HYSTERIA_SERVICE_UNIT` env. install-node.sh writes
`HYSTERIA_SERVICE_UNIT=hysteria` to env file. Agent now skips spawn when
that env is set, only writes config + reloads via `systemctl restart hysteria`
on ApplyInbound.

If you see this on an OLDER install: append `HYSTERIA_SERVICE_UNIT=hysteria`
to `/etc/ice-panel-node/env`, then `systemctl restart ice-panel-node`. Rebuild
agent if it's pre-cycle-5 source.

### Hysteria ACME stuck on `your.domain.net`

**Symptom:** `journalctl -u hysteria` shows ACME failing for `your.domain.net`
or `your@email.com` even though you passed `--hysteria-domain`/`--hysteria-email`.

**Why (two distinct historical bugs):**
1. **Pre-cycle-5**: install-node.sh `--reset` didn't wipe
   `/etc/hysteria/config.yaml`. Re-install saw "config already exists, keeping"
   and used the placeholder values from the first failed install.
2. **Pre-cycle-6** (caught on Aeza fresh install 2026-05-12): The official
   `get.hy2.sh` script that runs BEFORE our config-writer creates
   `/etc/hysteria/config.yaml` with placeholder `your.domain.net`. Our
   "skip if file exists" check then kept the placeholder and silently
   ignored the admin's `--hysteria-domain`. Symptom was hysteria crashlooping
   on `failed to obtain certificate for your.domain.net`.

**Permanent fixes shipped:**
- `do_uninstall()` removes `/etc/hysteria/config.yaml`, `/etc/xray/config.json`,
  and the related systemd unit drop-ins (closes #1).
- install-node.sh now grep's the existing config for `${HY_DOMAIN}` — only
  preserves it when our domain is already there; otherwise overwrites the
  placeholder (closes #2). Also disables `hysteria-server.service` (the unit
  get.hy2.sh installs) so its placeholder config can't race ours.

If you hit either on an older install:
```
rm /etc/hysteria/config.yaml
systemctl disable --now hysteria-server.service
# rewrite config manually with real domain/email, or re-run install-node.sh --reset
systemctl restart hysteria
```

### Test-Connect shows TCP timeout for Hysteria / AmneziaWG

**Not a bug.** Test-Connect uses a TCP probe; UDP-based protocols
(Hysteria, AmneziaWG, Mieru) don't open `:443/tcp`. Panel surfaces a
yellow ⚠ note `UDP-based protocol — tested TCP port reachability only`.

Real validation = client connects through the actual protocol.

### Hysteria 2: handshake works but tx=0 / iOS clients see Timeout

**Symptom:** server logs `auth accepted` + `client connected`, but
no actual traffic — iOS Hiddify / Happ / Streisand show "Timeout" or
0-byte transfer. CLI clients on desktop/Linux work fine to the same server.

**Three root causes seen, in order of frequency:**

1. **iOS users on RU ISPs.** TSPU / Russian ISPs aggressively throttle
   bare QUIC on UDP/443. Server-side everything looks healthy. We've hit
   this in cycle #2 and again in cycle #5. Workarounds, in priority order:
   - **Port-hopping** (slice 31.5, shipped 2026-05-11) — install-node.sh
     applies an iptables UDP REDIRECT `20000-50000 → :443` (managed by
     `ice-panel-hyhop.service`). In the panel: open the Hysteria profile,
     fill "Port range start/end" (e.g. 20000/50000) and save. URI now
     emits `mport=20000-50000`, sing-box `server_ports`, Clash `ports`,
     and the client rotates UDP ports per connection. TSPU can't pin a
     single port to throttle. The profile range MUST be a subset of the
     install-time range — to widen, re-run install-node.sh with
     `--hysteria-port-range START-END`. To disable on a given node, pass
     `--hysteria-port-range ''`.
   - **Non-443 UDP port** — switching to e.g. 12443/udp often pushes the
     traffic past portspec-based filters.
   - **Different hosting / route** — Hetzner DE / OVH FR routes from RU
     are usually cleaner than Beget SE. Last-resort.

2. **Happ (iOS) ≠ Hiddify (iOS).** Happ uses Xray-core's `hysteria2`
   outbound implementation; Hiddify uses sing-box's. Verified on 2026-05-12
   cycle #6 reality-check: with the SAME server, SAME subscription URL,
   on the SAME iPhone on RU mobile carrier:
   - **Happ**: tunnel auth passes, streams to Fastly/Cloudflare/Apple/
     Telegram open then get `canceled by remote with error code 0` — pages
     never load. Xray-core's hysteria2 outbound appears to mis-negotiate
     Brutal CC with our `ignoreClientBandwidth: true` + `mport=` combo.
   - **Hiddify Next (desktop and iOS)**: 9 MB+ traffic flows cleanly,
     YouTube streams, ifconfig.me returns the server IP, no stream-cancel
     errors in server logs.
   - **CLI hysteria client** (server-side smoke): identical setup —
     ifconfig.me returns server IP in 50ms via SOCKS5.

   **Recommendation:** prefer Hiddify Next for Hysteria 2 on iOS. Happ
   is fine for Xray (VLESS/Trojan REALITY) — the divergence is specifically
   in Xray-core's hysteria2 outbound. Track as a Happ-side bug, not ours.

3. **Salamander obfs mismatch between sing-box client and hysteria server.**
   sing-box (which iOS Hiddify / Streisand all use under the hood) may
   negotiate Salamander differently from upstream `hysteria` CLI. If
   panel CLI works but iOS clients don't, try removing obfs from the
   profile temporarily to confirm.

4. **`ignoreClientBandwidth` missing on server.** Brutal CC requires the
   client to declare its own bandwidth. Some clients send 0 → tunnel
   establishes but `tx=0`. Fix shipped: agent renders
   `ignoreClientBandwidth: true` by default; URI builder also emits
   `upmbps`/`downmbps` so Brutal CC stays usable when the server respects
   client bandwidth.

**Diagnostic sequence:**
```bash
# On node — is hysteria getting our packets at all
tcpdump -i any -n udp port 443 -c 20

# On panel — try a CLI client to isolate "server vs client" axis
hysteria client -c /tmp/hy2-client.yaml &
curl -x socks5h://127.0.0.1:1080 https://ifconfig.me
# expected: returns the node's IP. If it does, server is fine and the
# remaining problem is client-side / network-side from the user.
```

### iOS Hysteria client connected but lost users on agent restart

**Symptom:** server log shows `hysteria auth rejected` for what should
be a known user. iOS client gets HTTP 404 on auth.

**Why:** the agent keeps the user→password map in-memory only. After
agent restart, nothing repushes existing users — `applyInbounds` is
event-driven (binding.created, profile.updated), not "agent came back up."

**Recovery:** trigger any profile event in the panel UI:
- Profiles → toggle `enabled` off → Save → on → Save  
- Or DeployProfileModal: uncheck node → Save → re-check → Save

Either fires `profile.updated` / `binding.updated` → applyInbounds
fan-out → addUser pushes the active users back to the agent.

**Architectural fix shipped 2026-05-11 (slice 38 follow-up):** agent
emits `X-Agent-Start-Time` (unix-nano of process start) in every
heartbeat. Panel stores last-seen value in Redis at
`node:<id>:agentStartTime` (TTL 7d). When incoming differs from
stored, panel enqueues an `applyNodeInbounds` BullMQ job that re-pushes
inbounds + all active users — no admin toggle needed. The manual
profile-toggle workaround below is now only for nodes still running
pre-cycle-6 agent binaries.

### Profile-edit Save doesn't seem to fire applyInbounds

If you toggle a value, save, and the node config doesn't change — check
that the toggle actually changed something. Many UIs no-op save when
the diff is zero. Forcing a real diff: change `enabled` then change
back.

### Subscription Test from inside the panel container

```bash
PANEL=icepanel-prod-backend
docker exec $PANEL node -e "
fetch('https://YOUR_NODE:8443/healthz', {signal: AbortSignal.timeout(5000)})
  .then(r => console.log('STATUS', r.status))
  .catch(e => console.log('ERR:', e.cause?.code || e.message))
"
```

`UNABLE_TO_VERIFY_LEAF_SIGNATURE` after panel rebuild = node was bootstrapped
against the old CA. Reissue bootstrap from UI + `--reset` reinstall.

### UFW open-to-world after install

**Symptom:** `ufw status verbose | grep 8443` shows
`8443/tcp  ALLOW  Anywhere` instead of restricting to panel IP.

**Why:** Old install command didn't auto-inject `--panel-ip`. Cycle-5+
generates the install command with the panel's egress IP baked in.

**Fix:**
```bash
ufw delete allow 8443/tcp
ufw allow from <PANEL_IP> to any port 8443 proto tcp
```

Or re-run install with `--reset --panel-ip <IP>`.

### Hot-rebuild node agent after pulling new code

When you ship a fix in `apps/node/...` and need to land it on a running
node without re-bootstrapping the whole cert/env state, just rebuild
the binary and restart the systemd unit:

```bash
ssh root@<NODE>
cd /opt/ice-panel-node && git pull && \
  cd apps/node && \
  CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/local/bin/ice-panel-node . && \
  systemctl restart ice-panel-node
journalctl -u ice-panel-node -n 5 --no-pager
```

Service name is `ice-panel-node` (not `ice-panel-nod`, common typo).
This preserves /etc/ice-panel-node/env, mTLS payload, and any per-protocol
configs already on disk — only the agent binary is replaced. After
restart, panel should resume normal applyInbounds / heartbeat without
any further intervention.

### `install-node.sh` fails with `Unexpected HTTP 410000 from panel`

**Symptom:** Running install-node.sh with a bootstrap token aborts with:
```
[fail] Unexpected HTTP 410000 from panel — see panel logs
```
Token was actually a clean `410 Gone` (already consumed).

**Why:** Pre-cycle-6 script used `curl -fsSL ... -w '%{http_code}' || echo "000"`.
The `-f` flag makes curl exit non-zero on HTTP 4xx/5xx (returns 22), which
triggered the `|| echo "000"` branch and **appended** `"000"` to whatever
`-w` had already written. Result: `"410" + "000" = "410000"`, which missed
the `case 410)` branch and fell through to the catch-all `*` with the
misleading concat'd code.

**Permanent fix shipped (cycle #6):** drop `-f`, fallback only on network
error (curl exits non-zero before writing any code):
```bash
HTTP_CODE=$(curl -sSL -o "$TMP_PAYLOAD" -w '%{http_code}' \
  "$PANEL_URL/api/internal/bootstrap/$BOOTSTRAP_TOKEN" 2>/dev/null) \
  || HTTP_CODE="000"
```

**Recovery:** bootstrap token is single-use. Hit `Refresh bootstrap` in the
panel UI to mint a new one. Re-run install-node.sh with the new token.

### `install-node.sh` interactive prompt rejects `y` even when typed

**Symptom:** Running install-node.sh on a node with previous install:
```
[warn] Detected previous ice-panel-node install on this VPS.
Wipe previous installation and continue? [y/N]: y
[fail] Aborted by user. Pass --reset to skip this prompt, or --uninstall to remove without re-installing.
```
You typed `y` and pressed Enter, script claims you aborted.

**Why (two causes):**
1. **Process substitution edge case.** `bash <(curl ...)` runs the script
   from a `<(...)` process-sub. `read -rp "..." ans </dev/tty` occasionally
   loses keypresses in that flow even though the prompt printed correctly.
2. **Mixed Cyrillic/Latin + backspace.** If you typed a Cyrillic letter
   first (e.g. `Н`, visually similar to `H`), realized the keyboard layout
   issue, backspaced, then typed `y` — `read` saw the raw byte sequence
   including the backspace control character and didn't end up with a
   clean `y` in `$ans`.

**Permanent fix shipped (cycle #6):** split the combined `read -rp` into
separate `printf` + `read` — the read then has `/dev/tty` as a proper
terminal handle, decoupled from the prompt-print side. Still recommend
passing `--reset` explicitly for non-interactive automation.

**Workaround on older script:** pass `--reset` flag to skip the prompt:
```bash
bash <(curl -fsSL .../install-node.sh) --reset --panel-url ... --bootstrap ...
```

## Reset / nuke from orbit

### Wipe a single node clean

```bash
ssh root@<NODE>
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) --uninstall
```

### Wipe panel volumes (DESTROYS DB AND REDIS)

```bash
cd /opt/ice-panel
docker compose -f docker-compose.prod.yml down -v
```

After this all data is gone. Migrations will rerun on next deploy. mTLS CA
will be re-generated, all existing nodes will have to re-bootstrap.

## Quick-look log commands

```bash
# Backend live
docker compose -f /opt/ice-panel/docker-compose.prod.yml --env-file /opt/ice-panel/.env.production logs -f backend

# Backend errors only
docker compose -f /opt/ice-panel/docker-compose.prod.yml --env-file /opt/ice-panel/.env.production logs --tail=200 backend | grep -E 'level":(40|50)|error|FATAL'

# Caddy 502s
journalctl -u caddy --since '5 min ago' | grep -i error

# Node agent live
journalctl -u ice-panel-node -f

# Hysteria live
journalctl -u hysteria -f
```
