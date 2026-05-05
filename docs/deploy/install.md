# Ice-Panel — one-command install

Two scripts cover the whole stack:

- **Panel** (admin's VPS): `scripts/install-panel.sh` — Docker-based.
- **Node** (each proxy VPS): `scripts/install-node.sh` — systemd-based, chains
  per-protocol bootstrap.

Both target Ubuntu 22.04+ / Debian 12+ and require root.

---

## 1. Panel

On the VPS that will host the admin UI / database / Redis:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

What you get after ~5-10 minutes (first build of the Docker images):

- `/opt/ice-panel/` — checkout of this repo
- `/opt/ice-panel/.env.production` — generated `JWT_SECRET` + Postgres password (mode 600)
- 4 containers running:
  - `icepanel-prod-postgres` (16-alpine, persistent volume)
  - `icepanel-prod-redis` (7-alpine, AOF persistence)
  - `icepanel-prod-backend` (Fastify, internal port 3000)
  - `icepanel-prod-frontend` (nginx serving Vite build, **publishes `:8080` on host**)
- Prisma migrations applied automatically (incl. SRR seed rules)

Then open `http://<vps-ip>:8080` in a browser — you'll see the **"Create first admin"** form.

### Customising

Override via env before the curl:

```bash
ICE_PANEL_DIR=/srv/ice          \
ICE_PANEL_REF=v0.2.0            \
FRONTEND_PORT=18080             \
CORS_ORIGIN=https://panel.mydomain.com \
bash <(curl -fsSL .../install-panel.sh)
```

### TLS in front

The script binds the SPA to plain HTTP on `:8080`. **Don't expose this directly.**

Recommended production setup:
- **Subdomain on Cloudflare with yellow cloud (Proxied)** for the panel — hides VPS IP, free DDoS, free TLS
- **Caddy on the VPS** with a Cloudflare Origin Certificate, listening on `:443`
- Panel-only: `panel.yourdomain.com` → CF edge → Caddy → `127.0.0.1:8080`
- Then close `:8080` from public internet via `ufw delete allow 8080/tcp`

> ⚠️ **Cloudflare proxy is for the PANEL ONLY** — never for proxy nodes.
> CF Free doesn't pass UDP (kills Hysteria/AmneziaWG) and CF's TLS-termination
> breaks Xray+REALITY's anti-fingerprint trick. Node DNS records should be
> **DNS only (gray cloud)**.

Full setup with all 4 options (Caddy direct / nginx / **Cloudflare proxied** / Cloudflare Tunnel),
including ufw lock-down to CF-only IPs and origin-cert install, in
**[reverse-proxy.md](./reverse-proxy.md)**.

### Update

```bash
cd /opt/ice-panel
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### Logs / ops

```bash
cd /opt/ice-panel
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f backend
docker compose -f docker-compose.prod.yml --env-file .env.production restart backend
docker compose -f docker-compose.prod.yml --env-file .env.production down
```

---

## 2. Node

### 2.1 Get a payload — use Download, not Copy

In the panel SPA → **Nodes** → **Create node** → fill name + address → in
the modal that pops up, click **Download**. You'll get
`<node-name>-payload.b64` (~6–7 KB).

> ⚠️ **Don't terminal-paste the payload.** Linux TTY canonical-mode truncates
> pasted strings at 4096 bytes. Real payloads are 6-7 KB, so anything pasted
> directly into a shell prompt loses the tail and the node-agent fails with
> a confusing `json unmarshal: unexpected end of JSON input`. The Download
> button + scp + `--payload-file` is the only reliable workflow.

Transfer the file to your VPS:

```bash
# from your laptop
scp <node-name>-payload.b64 root@<vps-ip>:/tmp/payload.b64
```

### 2.2 Install on the VPS

**Recommended flow — flags with `--payload-file`** (skips TTY pasting):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --protocol xray \
  --payload-file /tmp/payload.b64
```

Replace `--protocol` with `xray` / `hysteria` / `amneziawg` / `naive`.

#### Or interactive

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh)
```

The script first asks for protocol (1-4), then asks for payload. **At the
payload prompt, type `@/tmp/payload.b64`** — the leading `@` tells the
script to read the file content directly. Don't paste the actual base64;
TTY truncates at 4096 bytes.

Either path works; explicit flags are tidier for automation.

What it does in each case:

1. Installs Go 1.23+ if missing
2. Clones the repo to `/opt/ice-panel-node`
3. Builds the static `ice-panel-node` Go binary → `/usr/local/bin/`
4. **Chains the protocol-specific bootstrap:**
   - `hysteria` → `bash <(curl get.hy2.sh)`
   - `xray` → official XTLS install-script
   - `amneziawg` → `apps/node/scripts/bootstrap-amneziawg.sh` (PPA + kernel-module check)
   - `naive` → `apps/node/scripts/bootstrap-naive.sh` (xcaddy + forwardproxy@naive)
5. Writes `/etc/ice-panel-node/env` with `NODE_PAYLOAD` + protocol-specific env
6. Drops `/etc/systemd/system/ice-panel-node.service` and starts it
7. Opens firewall ports via `ufw`
8. Polls `https://127.0.0.1:8443/healthz` until it answers

After ~30s the panel should show the node as **connected** in the Nodes table.

### 2.3 Update

```bash
cd /opt/ice-panel-node
git pull
go build -trimpath -ldflags="-s -w" -o /usr/local/bin/ice-panel-node ./apps/node
systemctl restart ice-panel-node
```

(`install-node.sh --protocol <same> --payload "<existing>"` does the same
end-to-end, but a re-build is faster.)

### 2.4 Logs / status

```bash
systemctl status ice-panel-node
journalctl -u ice-panel-node -f
journalctl -u hysteria-server -f   # protocol-side
journalctl -u awg-quick@awg0 -f
```

### 2.5 Switching protocols on a node

Don't. Spin up a fresh VPS — protocols share kernel/network state in messy
ways (Hysteria UDP listeners vs AmneziaWG's wg0 interface vs Caddy's :443).
Single-protocol-per-node is the supported pattern (see ROADMAP §"Модель деплоя").

---

## Troubleshooting

### Panel: `/health` shows `db: down` or `redis: down`
Container slow to come up. `docker compose ... logs postgres` / `redis`. Usually
just retry; if persistent, check `df -h` and `free -m`.

### Panel SPA shows "Network Error" on every API call
CORS misconfig. Check `.env.production`'s `CORS_ORIGIN` matches the URL you're
loading the SPA from (scheme + host + port must match exactly).

### Node: `/healthz` never answers
- Wrong payload — base64 must be the exact string from the modal, no whitespace.
- Time skew — mTLS rejects certs with future-dated `NotBefore`. `timedatectl set-ntp true`.
- Firewall — `ufw status`. Panel reaches the node on `NODE_PORT` (default 8443/tcp).

### AmneziaWG: bootstrap reports DKMS failure
Modern kernel (6.8+) sometimes can't compile the module. The bootstrap script
notes this and prints the userspace fallback. The adapter doesn't auto-fall-back
yet — manual `apt install amneziawg-go` + edit the `awg-quick` PATH if you want
to keep going without kernel mode.

### Naive: `xcaddy build` OOMs on a 1 GB VPS
Need ≥2 GB to compile Caddy. Either resize, or build the binary on a beefier
machine and `scp` it over.
