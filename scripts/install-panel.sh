#!/usr/bin/env bash
# Ice-Panel one-command installer.
#
# What it does:
#   1. Verifies Docker + Compose plugin (installs them on Ubuntu/Debian if missing)
#   2. Clones this repo into $ICE_PANEL_DIR (default /opt/ice-panel)
#   3. Generates `.env.production` with random JWT_SECRET + Postgres password
#   4. Builds the panel-backend / panel-frontend images locally
#   5. Runs Prisma migrate deploy (one-shot service)
#   6. Brings up the full stack and waits for health
#
# Idempotent — safe to rerun. Won't overwrite an existing .env.production.
#
# Usage (as root):
#   bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
#
# Or with a specific tag/branch:
#   ICE_PANEL_REF=v0.1.0 bash <(curl ...)
#
# Customisation via env:
#   ICE_PANEL_DIR        Install dir (default /opt/ice-panel)
#   ICE_PANEL_REPO       Git URL (default https://github.com/0xIC3/Ice-Panel.git)
#   ICE_PANEL_REF        Branch/tag/sha (default main)
#   FRONTEND_PORT        Host port the SPA listens on (default 8080)
#   CORS_ORIGIN          Allowed origin for the API (default http://<vps-ip>:<FRONTEND_PORT>)
#   PANEL_DOMAIN         If set (e.g. panel.example.com), install + configure Caddy
#                        with auto-TLS. CORS_ORIGIN is auto-set to https://$PANEL_DOMAIN.
#                        DNS A record for the domain MUST already point at this VPS,
#                        otherwise Let's Encrypt HTTP-01 challenge will fail.

set -euo pipefail

log()  { printf '\033[1;34m[install-panel]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must run as root (sudo bash $0)"

ICE_PANEL_DIR=${ICE_PANEL_DIR:-/opt/ice-panel}
ICE_PANEL_REPO=${ICE_PANEL_REPO:-https://github.com/0xIC3/Ice-Panel.git}
ICE_PANEL_REF=${ICE_PANEL_REF:-main}
FRONTEND_PORT=${FRONTEND_PORT:-8080}
PANEL_DOMAIN=${PANEL_DOMAIN:-}

# ───── 1. Distro check ─────
if [[ ! -r /etc/os-release ]]; then
  fail "Cannot read /etc/os-release; only Ubuntu/Debian supported here"
fi
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian are supported. Detected ID=${ID:-unknown}." ;;
esac
log "Detected $PRETTY_NAME"

# ───── 2a. OS upgrade (idempotent) ─────
# Apply pending security + package updates before installing anything heavy.
# Skip with SKIP_OS_UPGRADE=1 if you've just rebuilt the image.
if [[ "${SKIP_OS_UPGRADE:-0}" != "1" ]]; then
  log "Upgrading OS packages (apt-get update + dist-upgrade)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" \
          dist-upgrade -y
  apt-get autoremove -y
fi

# ───── 2b. Firewall — open the bare minimum, then enable ─────
# Order matters: allow SSH FIRST so we don't lock ourselves out, only then
# flip the defaults to deny + enable.
if [[ "${SKIP_FIREWALL:-0}" != "1" ]]; then
  if ! command -v ufw >/dev/null; then
    apt-get install -y ufw
  fi
  log "Configuring firewall (ufw): allow SSH + 80/443, deny everything else inbound"
  ufw allow 22/tcp                       >/dev/null 2>&1 || true
  # 80+443 always open — needed for Caddy TLS + ACME HTTP-01 challenges
  ufw allow 80/tcp                       >/dev/null 2>&1 || true
  ufw allow 443/tcp                      >/dev/null 2>&1 || true
  # In domain mode, the SPA port stays internal (Caddy proxies 127.0.0.1:$FRONTEND_PORT).
  # In bare-IP / testing mode, expose it directly so the browser can hit it.
  if [[ -z "$PANEL_DOMAIN" ]]; then
    ufw allow "${FRONTEND_PORT}/tcp"     >/dev/null 2>&1 || true
  fi
  ufw default deny incoming  >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable         >/dev/null
  log "ufw status: $(ufw status | head -1)"
fi

# ───── 2c. Docker ─────
if ! command -v docker >/dev/null; then
  log "Installing Docker (official get.docker.com installer)"
  curl -fsSL https://get.docker.com | sh
fi
# Compose plugin is bundled with modern Docker, but the convenience-script
# image used by some clouds may ship without it.
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-plugin
fi
log "Docker: $(docker --version)"
log "Compose: $(docker compose version)"

# ───── 3. Source checkout ─────
if [[ ! -d "$ICE_PANEL_DIR/.git" ]]; then
  log "Cloning $ICE_PANEL_REPO@$ICE_PANEL_REF into $ICE_PANEL_DIR"
  apt-get install -y git
  git clone --depth 1 --branch "$ICE_PANEL_REF" "$ICE_PANEL_REPO" "$ICE_PANEL_DIR"
else
  log "Updating existing checkout at $ICE_PANEL_DIR"
  git -C "$ICE_PANEL_DIR" fetch --depth 1 origin "$ICE_PANEL_REF"
  git -C "$ICE_PANEL_DIR" checkout "$ICE_PANEL_REF"
  git -C "$ICE_PANEL_DIR" reset --hard "origin/$ICE_PANEL_REF" || true
fi
cd "$ICE_PANEL_DIR"

# ───── 4. .env.production ─────
ENV_FILE="$ICE_PANEL_DIR/.env.production"
if [[ -f "$ENV_FILE" ]]; then
  log ".env.production already exists; keeping current secrets"
else
  log "Generating .env.production with fresh secrets (openssl rand -hex)"
  apt-get install -y openssl >/dev/null 2>&1 || true
  PG_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  if [[ -n "$PANEL_DOMAIN" ]]; then
    CORS_ORIGIN_VAL=${CORS_ORIGIN:-https://${PANEL_DOMAIN}}
  else
    CORS_ORIGIN_VAL=${CORS_ORIGIN:-http://${PUBLIC_IP}:${FRONTEND_PORT}}
  fi
  cat > "$ENV_FILE" <<EOF
# Generated by install-panel.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
POSTGRES_USER=icepanel
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_DB=icepanel

DATABASE_URL=postgres://icepanel:${PG_PASSWORD}@postgres:5432/icepanel
REDIS_URL=redis://redis:6379

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h
LOG_LEVEL=info

CORS_ORIGIN=${CORS_ORIGIN_VAL}
FRONTEND_PORT=${FRONTEND_PORT}
EOF
  chmod 600 "$ENV_FILE"
fi

# ───── 5. Build images ─────
log "Building backend + frontend images (first run takes 5-10 min)"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" build

# ───── 6. Migrate ─────
log "Running Prisma migrations"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" run --rm migrate

# ───── 7. Up ─────
log "Starting full stack"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d

# ───── 8. Wait for health ─────
log "Waiting for backend /health to return 200 (up to 60s)"
for i in $(seq 1 60); do
  if docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" exec -T backend \
       wget -qO- http://127.0.0.1:3000/health 2>/dev/null | grep -q '"status":"ok"'; then
    log "Backend is healthy"
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    warn "Backend didn't reach /health within 60s — check logs:"
    warn "  docker compose -f $ICE_PANEL_DIR/docker-compose.prod.yml logs backend"
  fi
done

# ───── 8b. Caddy reverse-proxy (domain mode) ─────
if [[ -n "$PANEL_DOMAIN" ]]; then
  log "Installing Caddy and configuring TLS for ${PANEL_DOMAIN}"
  if ! command -v caddy >/dev/null; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
  cat > /etc/caddy/Caddyfile <<EOF
${PANEL_DOMAIN} {
  reverse_proxy 127.0.0.1:${FRONTEND_PORT}
}

# Anti-probing: bare-IP / unknown hostname requests on :443 get a silent 204
# so scanners can't fingerprint Ice-Panel.
:443 {
  tls internal
  respond 204
}
EOF
  systemctl enable --now caddy >/dev/null 2>&1 || true
  systemctl reload caddy || systemctl restart caddy
  log "Caddy configured. TLS certificate will be issued by Let's Encrypt on first request."
fi

# ───── 9. Done ─────
PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo
log "🎉 Ice-Panel is running."
echo
if [[ -n "$PANEL_DOMAIN" ]]; then
  echo "  SPA:        https://${PANEL_DOMAIN}"
  echo "  API:        https://${PANEL_DOMAIN}/api"
else
  echo "  SPA:        http://${PUBLIC_IP}:${FRONTEND_PORT}"
  echo "  API:        http://${PUBLIC_IP}:${FRONTEND_PORT}/api"
fi
echo "  Install dir: ${ICE_PANEL_DIR}"
echo "  .env file:   ${ENV_FILE}  (chmod 600 — keep it secret)"
echo
echo "Next steps:"
echo "  1. Open the SPA in a browser — you'll see 'Create first admin'."
echo "  2. Provision a node from the Nodes tab → install-node.sh on the proxy VPS."
echo
echo "⚠ Production deployments MUST front the panel with TLS before exposing"
echo "   publicly. Plain HTTP on :${FRONTEND_PORT} is fine for testing only."
echo
echo "Quick TLS setup with Caddy (one machine, one Caddyfile):"
echo "    apt-get install -y caddy"
echo "    cat > /etc/caddy/Caddyfile <<'EOF'"
echo "    panel.yourdomain.com {"
echo "      reverse_proxy 127.0.0.1:${FRONTEND_PORT}"
echo "    }"
echo "    # Anti-probing: anyone hitting the bare IP on :443 gets a silent 204"
echo "    # so scanners can't fingerprint Ice-Panel by hostname."
echo "    :443 {"
echo "      tls internal"
echo "      respond 204"
echo "    }"
echo "    EOF"
echo "    systemctl reload caddy"
echo
echo "Then re-run the installer with CORS_ORIGIN=https://panel.yourdomain.com"
echo "so the backend whitelists the new origin."
echo
echo "Full reverse-proxy guide (Caddy / nginx / Traefik / Cloudflare-tunnel):"
echo "  ${ICE_PANEL_DIR}/docs/deploy/reverse-proxy.md"
echo
echo "Common ops:"
echo "  cd ${ICE_PANEL_DIR}"
echo "  docker compose -f docker-compose.prod.yml --env-file .env.production logs -f -t"
echo "  docker compose -f docker-compose.prod.yml --env-file .env.production restart backend"
echo "  git pull && docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build"
