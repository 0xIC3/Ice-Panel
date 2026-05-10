# Troubleshooting

Knowledge accumulated in production. When you hit one of these symptoms, the
fix is here — don't re-debug it from scratch.

## Cycle marker

Last updated: 2026-05-10 (after cycle #5 — Hysteria 2 onboarding to ice-hys2-test).

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

**Why:** install-node.sh `--reset` (pre-cycle-5) didn't wipe
`/etc/hysteria/config.yaml`. Re-install saw "config already exists, keeping"
and used the placeholder values from the first failed install.

**Permanent fix shipped:** `do_uninstall()` now removes
`/etc/hysteria/config.yaml`, `/etc/xray/config.json`, and the related
systemd unit drop-ins.

If you hit it on an older install: `rm /etc/hysteria/config.yaml` and re-run
install with `--reset`.

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

2. **Salamander obfs mismatch between sing-box client and hysteria server.**
   sing-box (which iOS Hiddify / Streisand / Happ all use under the hood)
   may negotiate Salamander differently from upstream `hysteria` CLI. If
   panel CLI works but iOS clients don't, try removing obfs from the
   profile temporarily to confirm.

3. **`ignoreClientBandwidth` missing on server.** Brutal CC requires the
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
