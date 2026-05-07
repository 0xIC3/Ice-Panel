# Ice-Panel — install runbook

Two scripts cover the whole stack:

- **Panel** (admin's VPS): `scripts/install-panel.sh` — Docker-based, one
  command provisions Postgres + Redis + backend + frontend + optionally Caddy
  with auto-TLS.
- **Node** (each proxy VPS): `scripts/install-node.sh` — systemd-based, one
  command provisions node-agent + the chosen protocol's server with config
  + ACME cert + firewall rules.

Both target Ubuntu 22.04+ / Debian 12+ and require root.

> Protocols validated end-to-end on real VPS as of 2026-05-06: **Xray
> VLESS+REALITY+Vision** ✅ and **Hysteria 2** ✅. AmneziaWG and NaiveProxy
> are coded but haven't been live-tested yet — manual config steps below
> are best-effort, file an issue if anything breaks.

---

## 1. Panel

### 1a. Bare-IP testing (HTTP only — for quick local tests)

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

After ~5–10 minutes (first Docker build) the SPA is live on
`http://<vps-ip>:8080`. **Don't run anything serious like this** — no TLS,
admin JWT cookies travel in cleartext.

### 1b. Production with auto-TLS (recommended)

Pre-requisites:
1. A domain you own with DNS managed somewhere (Cloudflare etc.)
2. An A-record pointing `panel.example.com` → VPS public IP, **DNS only
   (gray cloud)** during install — Caddy needs Let's Encrypt HTTP-01 to
   reach the VPS directly. You can flip to **Proxied** after the cert is
   issued (Cloudflare Full-strict mode + Origin Cert — see
   [reverse-proxy.md](./reverse-proxy.md)).
3. DNS propagation done — verify with `dig panel.example.com +short` from
   another machine.

Then on the panel VPS:

```bash
sudo -i
PANEL_DOMAIN=panel.example.com \
  bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

What you get:

- `/opt/ice-panel/` — checkout
- `/opt/ice-panel/.env.production` — generated `JWT_SECRET` + Postgres
  password + `CORS_ORIGIN=https://panel.example.com` (mode 600)
- 4 containers: `postgres`, `redis`, `backend`, `frontend`
- **Caddy** installed from the official cloudsmith repo
- `/etc/caddy/Caddyfile` proxies `panel.example.com` → `127.0.0.1:8080`
- Anti-probing block (`:443 { tls internal; respond 204 }`) — bare-IP
  hits get a silent 204 so scanners can't fingerprint Ice-Panel by
  hostname
- `ufw` allows only 22/80/443 — internal `:8080` is **not** exposed
- Prisma migrations applied automatically (incl. SRR seed rules)

Then open `https://panel.example.com` → "Create first admin" form → done.

### 1c. Customising

Override via env before the curl:

```bash
PANEL_DOMAIN=panel.example.com  \
ICE_PANEL_DIR=/srv/ice          \
ICE_PANEL_REF=v0.2.0            \
SKIP_OS_UPGRADE=1               \
  bash <(curl -fsSL .../install-panel.sh)
```

| Var | Default | Notes |
|---|---|---|
| `PANEL_DOMAIN` | unset | If set → installs Caddy and writes Caddyfile, sets `CORS_ORIGIN=https://$PANEL_DOMAIN` |
| `ICE_PANEL_DIR` | `/opt/ice-panel` | Install path |
| `ICE_PANEL_REF` | `main` | Git ref to check out |
| `FRONTEND_PORT` | `8080` | Internal SPA port (only exposed to public when `PANEL_DOMAIN` is unset) |
| `CORS_ORIGIN` | derived | Override only if frontend lives on a different host |
| `SKIP_OS_UPGRADE` | `0` | Skip `apt-get dist-upgrade` (faster on a freshly-rebuilt image) |
| `SKIP_FIREWALL` | `0` | Skip `ufw` setup (managed firewall elsewhere) |

### 1d. Update

```bash
cd /opt/ice-panel
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### 1e. Logs / ops

```bash
cd /opt/ice-panel
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f backend
docker compose -f docker-compose.prod.yml --env-file .env.production restart backend
docker compose -f docker-compose.prod.yml --env-file .env.production down -v   # destroy + restart from scratch
```

---

## 2. Node — one-command per protocol

The general flow:

1. Add a **DNS A-record** (only Hysteria / NaiveProxy require a domain;
   Xray and AmneziaWG can use the bare IP). Cloudflare row → **DNS only**.
2. In the panel SPA: **Nodes → Create node** → fill `name` + `address`
   (`<host-or-ip>:8443`). Submit. The modal reveals a **bootstrap command**
   already pre-filled with your panel URL + a single-use 15-min token.
3. SSH to the node VPS, paste the command + add per-protocol flags
   (sections below).
4. Wait ~30 s — the node's status flips from `UNKNOWN` → `ONLINE` in
   the panel UI.

If the bootstrap token expires before you redeem it, click the **key
icon** (Refresh bootstrap) on the node row in the UI to mint a new one.

> ⚠️ **`node.address` is BOTH the mTLS control-plane endpoint AND the
> public host emitted in client URIs** until slice 25 (Hosts abstraction)
> ships. So:
> - For Hysteria / NaiveProxy: set `node.address` to the **public domain**
>   (e.g. `hy2-01.example.com:8443`) at create time. The mTLS cert SAN
>   gets generated from this string, so changing it later forces a full
>   `Refresh bootstrap` cycle.
> - For Xray / AmneziaWG (no domain): use `<public-ip>:8443`.

### 2.1 Xray (VLESS + REALITY + Vision)

Pre-reqs: VPS public IP, no domain needed (REALITY uses SNI spoofing).

In the panel: **Inbounds → Create** → Protocol = Xray → fill in REALITY
fields → click **Generate** for the keypair → save. Copy the **private
key**, **short ID**, and **server name** somewhere — you'll paste them
into the install command.

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol xray \
  --xray-reality-private-key sI_p9bg-7cy...   \
  --xray-reality-short-ids   abc123           \
  --xray-reality-server-names www.cloudflare.com \
  --xray-reality-dest        www.cloudflare.com:443
```

What it does:
- OS upgrade (skip with `SKIP_OS_UPGRADE=1`)
- `ufw`: 22/tcp + 8443/tcp (mTLS) + 443/tcp (Xray)
- Installs Go 1.23+ and builds `ice-panel-node` from this repo
- Installs Xray via XTLS install-script
- Pre-fills `/etc/ice-panel-node/env` with REALITY params so the Xray
  adapter spawns a working REALITY listener at startup
- Starts `ice-panel-node.service`

After ~30 s: panel shows node `ONLINE`, Xray listening on `:443`,
subscription URL works in any client.

### 2.2 Hysteria 2

Pre-reqs:
1. A subdomain (`hy2-01.example.com`) with a DNS A-record → VPS IP,
   **DNS only** in Cloudflare (UDP-443 doesn't go through CF Free's
   yellow-cloud anyway).
2. Wait for DNS to propagate.

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol hysteria \
  --hysteria-domain hy2-01.example.com \
  --hysteria-email admin@example.com
```

Optional flags:
- `--hysteria-masquerade-url https://en.wikipedia.org/` — what the server
  pretends to be when scanned (default: `https://www.bing.com/`)
- `--hysteria-obfs-password <pwd>` — enable Salamander obfuscation

What it does (in addition to the common steps):
- `ufw`: 22/tcp + 8443/tcp + 443/udp + 80/tcp (ACME HTTP-01)
- Installs Hysteria via the official `get.hy2.sh`
- Writes `/etc/hysteria/config.yaml` with ACME on the domain you passed,
  HTTP auth callback on `127.0.0.1:9000` (handled by node-agent), and
  the masquerade target
- Drops `/etc/systemd/system/hysteria.service` and starts it
- Hysteria's first run obtains the LE cert via HTTP-01 (so port 80 must
  be open until that succeeds — about 5 seconds)

In the panel: **Inbounds → Create** → Protocol = Hysteria 2 → public
host = your domain → save. Then add `hysteria` to the user's
`enabledProtocols` and the subscription URL gains the new endpoint.

### 2.3 AmneziaWG (manual config — auto-flags coming in slice 24)

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol amneziawg
```

This installs the kernel module via DKMS (`amneziawg-dkms`) and the userspace
tools (`amneziawg-tools`). If DKMS fails on your kernel, the bootstrap script
prints a fallback path to userspace `amneziawg-go`.

In the panel create an AmneziaWG inbound with the obfuscation params
(Jc/Jmin/Jmax/S1-S4/H1-H4 — use the **TSPU** preset on Russian carriers
or **Mobile** for cellular). The panel allocates a `/24` subnet by
default; per-user IPs are issued automatically when users get
`amneziawg` in `enabledProtocols`.

You'll need to manually wire the inbound's params to `/etc/ice-panel-node/env`
(slice 24 will auto-push these). See the AmneziaWG section in
[../../apps/node/README.md](../../apps/node/README.md) for the env keys.

### 2.4 NaiveProxy (manual config — auto-flags coming in slice 24)

Pre-reqs: 2 GB RAM minimum (xcaddy build is heavy), domain like
`naive-01.example.com`.

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol naive
```

This builds Caddy with `klzgrad/forwardproxy@naive` plugin and installs
it as `/usr/local/bin/caddy-naive`. You then drop a Caddyfile at
`/etc/caddy/Caddyfile` (template in `apps/node/scripts/bootstrap-naive.sh`)
and wire it to the inbound created in the panel. **No per-user stats** —
upstream limitation.

> Hiddify doesn't natively parse `naive+https://` URIs in singbox format;
> for testing use **NekoBox** or the Naïve Chrome extension.

### 2.5 Shadowsocks 2022 (runs inside xray-core)

No separate binary — SS2022 multi-user is driven by the same xray-core
that powers VLESS REALITY. The installer reuses the xray install path.

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol shadowsocks
```

The SS adapter on the node-agent spawns its own xray-api inbound at
`127.0.0.1:8081` (one above the VLESS adapter's `:8080` so they don't
collide if both run on the same node). Listens on TCP+UDP/443 by default;
firewall opens both. Cipher defaults to `2022-blake3-aes-256-gcm` —
override via `SHADOWSOCKS_METHOD` env if you have legacy clients.

> Default per-user PSK is the user's `xrayUuid` — no separate
> `users.shadowsocksPassword` column. xray-core hashes the UUID string
> down to the right key length internally; modern SS2022 clients
> (Outline, NekoBox, sing-box, Hiddify) accept this transparently.

### 2.6 MTProto (Telegram-only, via 9seconds/mtg)

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol mtproto
```

Chains `apps/node/scripts/bootstrap-mtg.sh` to install the latest mtg
release at `/usr/local/bin/mtg`. ENV file gets `MTG_BINARY`,
`MTG_CONFIG=/etc/mtg/config.toml`, `MTG_PORT=443`, `MTG_STATS_PORT=3129`.
Domain is per-inbound (set in panel UI when creating the MTProto
inbound) — Fake-TLS handshake masquerades as that real HTTPS host.

> Architectural caveat: mtg is intentionally **single-secret upstream**
> ("multiple secrets solve no problems and just complex software" — per
> the upstream maintainer). One MTProto inbound = one secret = every
> squad member shares the same URI. Per-user accounting is not
> available; for that, use Xray instead.

### 2.7 Mieru (stealth proxy via enfein/mieru)

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol mieru
```

Chains `apps/node/scripts/bootstrap-mieru.sh` to place `mita` at
`/usr/local/bin/mita`. ENV file gets `MITA_BINARY` +
`MITA_CONFIG=/etc/mita/server.json`. The node-agent invokes
`mita apply config <path>` and `mita reload` to manage user lists.

> Per-user creds reuse `username + xrayUuid` — no separate password
> column. Subscription endpoint serves a JSON profile via
> `?format=mieru-json` for mieru-cli / GoMieru-Android / mieru-iOS.

---

## 3. Verification

### 3.1 Panel health

```bash
curl -s https://panel.example.com/health | jq
# expect: {"status":"ok","db":"ok","redis":"ok"}
```

### 3.2 Node mTLS reachability (from the panel VPS)

```bash
nc -vz <node-ip-or-domain> 8443
```

(Should print `succeeded`. The handshake itself fails because `nc` doesn't
present a client cert — that's expected and only verifies network
reachability.)

### 3.3 Subscription dump

Get the subscription URL from the user row's **copy-link** action in the
SPA. Then:

```bash
curl -s 'https://panel.example.com/sub/<token>' | base64 -d
# expect: vless://...   (and/or hysteria2://... etc., one per inbound)
```

Hiddify's UA gets singbox JSON via SRR (slice 22), other clients get
plain base64 by default.

---

## 4. Troubleshooting

### `/health` shows `db: down` or `redis: down`
Container slow to come up. Tail `docker compose ... logs postgres` /
`redis`. Usually just retry; if persistent, check `df -h` and `free -m`.

### SPA shows "Network Error" on every API call
CORS misconfig. Check `.env.production`'s `CORS_ORIGIN` matches the URL
you're loading the SPA from (scheme + host + port must match exactly).

### Node: `/healthz` never answers
- Wrong payload — base64 must be the exact string from the modal, no
  whitespace. Use `--bootstrap` flow to dodge TTY truncation.
- Time skew — mTLS rejects certs with future-dated `NotBefore`.
  `timedatectl set-ntp true`.
- Firewall — `ufw status`. Panel reaches the node on `8443/tcp`.

### Node: status stuck at `UNKNOWN` even though node-agent is up
The status poller runs every 30 s. If you just registered the node, wait
30 s. If it's been longer:
```bash
# on panel VPS
docker compose -f /opt/ice-panel/docker-compose.prod.yml --env-file /opt/ice-panel/.env.production logs backend --tail 50 | grep -iE "node-healthcheck|FAILED"
```
`fetch failed` means the panel can't reach the node — usually `node.address`
points to a domain whose mTLS cert SAN was generated for a different IP.
Fix: hit the **Refresh bootstrap** key icon on the node row, then re-run
install-node.sh on the VPS with the new token.

### Hysteria: "obtaining certificate" hangs
Port 80 not reachable from public Internet. ACME HTTP-01 needs `:80/tcp`
during the cert dance. Open it in your provider's firewall too if there's
an upstream layer.

### Hysteria: client connects but "auth rejected"
Means UDP/handshake works but the user's password isn't on the node.
Most common cause: user was created BEFORE the node — that's slice 23.1
backfill territory; if backfill failed, just edit the user (toggle a
field, save) and the resulting `addUser` job will fan out.

### AmneziaWG: bootstrap reports DKMS failure
Modern kernel (6.8+) sometimes can't compile the module. The bootstrap
script notes this and prints the userspace fallback. The adapter doesn't
auto-fall-back yet — `apt install amneziawg-go` + edit the `awg-quick`
PATH if you want to keep going without kernel mode.

### NaiveProxy: `xcaddy build` OOMs on a 1 GB VPS
Need ≥2 GB to compile Caddy. Either resize, or build the binary on a
beefier machine and `scp` it over.

### Hiddify: "Unknown parse outbound" or "TLS required"
Both of these were fixed during the 2026-05-06 VPS test (commits in
`apps/panel-backend/src/core-adapters/hysteria/uri.ts` and
`apps/panel-backend/src/modules/subscription/formats/singbox.ts`). If
you still hit them, your panel is on an older revision — `git pull`
and rebuild the backend container.

---

## 5. What's NOT yet automated (slice 24 / 25 backlog)

| Feature | Today | After slice 24 / 25 |
|---|---|---|
| Per-user Xray traffic accounting | Always 0 / quota | Real bytes via Xray StatsService gRPC |
| Inbound config push to nodes | Manual env edit | Panel auto-pushes via mTLS |
| `node.address` overload | Set domain at create time | Separate `publicHost` field on inbound |
| AmneziaWG / NaiveProxy auto-config | Manual env edit | One-command flags like Hysteria/Xray today |

See `memory/project_current_state.md` for the full slice plan.
