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

# ───── Concurrency + apt lock hygiene ─────
# Caught live cycle #6 2026-05-13: operator ran the installer twice
# (impatient retry after the curl looked like it hung), 2nd run crashed
# on `apt-get` lock held by the 1st. Three layered protections:
#
# 1. flock(1) on /var/run/ice-panel-install.lock — refuses a second
#    concurrent install-panel.sh on the same host.
# 2. APT_OPTS includes DPkg::Lock::Timeout=300 — apt waits up to 5 min
#    for the lock instead of failing instantly. Covers the common case
#    where Ubuntu's `unattended-upgrades` is running at boot.
# 3. Stale-lock cleanup — if a previous apt-get process died ungracefully
#    and left the lock file behind (no actual process holds it), nuke it
#    and run `dpkg --configure -a` to finish any half-applied state.
exec 9>/var/run/ice-panel-install.lock || fail "cannot open install lockfile"
if ! flock -n 9; then
  fail "another install-panel.sh is already running (lock held). Wait for it, or 'rm /var/run/ice-panel-install.lock' if you're sure it crashed."
fi

APT_OPTS=(-o "DPkg::Lock::Timeout=300" -o "Dpkg::Options::=--force-confold" -o "Dpkg::Options::=--force-confdef")
APT_ENV=(env DEBIAN_FRONTEND=noninteractive APT_LISTCHANGES_FRONTEND=none)

cleanup_stale_apt_locks() {
  local lock_holder
  # Check all common apt/dpkg lock files. If a lock file exists but no
  # process holds it (fuser empty), it's stale.
  for lockfile in /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock; do
    [[ -e "$lockfile" ]] || continue
    lock_holder=$(fuser "$lockfile" 2>/dev/null || true)
    if [[ -z "$lock_holder" ]]; then
      log "stale apt lock detected at $lockfile (no process holds it), removing"
      rm -f "$lockfile"
    fi
  done
  # Run dpkg --configure -a in case an interrupted apt left packages
  # in a half-configured state. No-op when everything is clean.
  dpkg --configure -a >/dev/null 2>&1 || true
}
cleanup_stale_apt_locks

ICE_PANEL_DIR=${ICE_PANEL_DIR:-/opt/ice-panel}
ICE_PANEL_REPO=${ICE_PANEL_REPO:-https://github.com/0xIC3/Ice-Panel.git}
ICE_PANEL_REF=${ICE_PANEL_REF:-main}
FRONTEND_PORT=${FRONTEND_PORT:-8080}
PANEL_DOMAIN=${PANEL_DOMAIN:-}
ACME_DEFAULT_EMAIL=${ACME_DEFAULT_EMAIL:-}

# ───── Interactive domain prompt ─────
# If PANEL_DOMAIN wasn't passed via env AND we have a real TTY (admin is
# running this hands-on, not from cron / cloud-init), ask. The
# `bash <(curl ...)` flow eats stdin with the curl pipe, so we read from
# /dev/tty directly — that's the actual terminal regardless of how stdin
# is wired.
if [[ -z "$PANEL_DOMAIN" && -r /dev/tty ]]; then
  printf '\n'
  printf '\033[1;36m═══════════════════════════════════════════════════════\033[0m\n'
  printf '\033[1;36m  Ice-Panel installer\033[0m\n'
  printf '\033[1;36m═══════════════════════════════════════════════════════\033[0m\n'
  printf '\n'
  printf 'На каком домене разместить панель?\n'
  printf '  Пример:    panel.example.com\n'
  printf '  Требование: A-запись домена ДОЛЖНА уже указывать на этот VPS\n'
  printf '              (иначе Let'\''s Encrypt не выпустит TLS-сертификат)\n'
  printf '\n'
  printf 'Оставь пустым и нажми Enter — установим без TLS, доступ по IP:%s\n' "$FRONTEND_PORT"
  printf '\n'
  printf '\033[1;33mДомен:\033[0m '
  read -r PANEL_DOMAIN </dev/tty || PANEL_DOMAIN=""

  if [[ -n "$PANEL_DOMAIN" ]]; then
    # Strip protocol if admin pasted full URL by accident.
    PANEL_DOMAIN="${PANEL_DOMAIN#http://}"
    PANEL_DOMAIN="${PANEL_DOMAIN#https://}"
    PANEL_DOMAIN="${PANEL_DOMAIN%/}"

    # Quick sanity-check on the value before we commit to it. Catches
    # the typo case where the admin types a single word without a dot.
    if [[ ! "$PANEL_DOMAIN" =~ \. ]]; then
      printf '\033[1;31m"%s" не похож на домен (нет точки). Установка прервана.\033[0m\n' "$PANEL_DOMAIN" >&2
      exit 1
    fi

    log "Будет установлено на https://${PANEL_DOMAIN} (Caddy + auto-TLS)"
  else
    log "Домен не указан — установка в bare-IP режиме (доступ по http://<ip>:${FRONTEND_PORT})"
  fi
  printf '\n'
fi

# ───── Interactive ACME email prompt ─────
# Cycle #6 (2026-05-12) — caught live: when this env was empty, the panel's
# install-node command-emitter fell back to `--hysteria-email admin@example.com`,
# and Let's Encrypt rejects @example.com as a forbidden test domain. The
# operator only finds out 15 minutes later when their fresh Hysteria node
# crashloops on cert obtain. Ask up-front; this also seeds Caddy's contact
# field for renewal warnings on the panel's own cert.
if [[ -z "$ACME_DEFAULT_EMAIL" && -r /dev/tty ]]; then
  printf 'Контактный email для Let'\''s Encrypt (получит уведомления о renewal'\''ах):\n'
  printf '  Используется и для Caddy панели, и автоматом подставляется в команду\n'
  printf '  установки Hysteria/Naive-нод как --hysteria-email / --naive-email.\n'
  printf '\n'
  printf 'Оставь пустым — придётся передавать email вручную при создании каждой ноды.\n'
  printf '\n'
  printf '\033[1;33mEmail:\033[0m '
  read -r ACME_DEFAULT_EMAIL </dev/tty || ACME_DEFAULT_EMAIL=""

  if [[ -n "$ACME_DEFAULT_EMAIL" ]]; then
    # Loose email check: must contain `@` and a `.` after it. Catches
    # typos / pasted strings without dot in TLD. LE itself will reject
    # @example.com / @example.net / @example.org as forbidden test domains.
    if [[ ! "$ACME_DEFAULT_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then
      printf '\033[1;31m"%s" не похож на email. Установка прервана.\033[0m\n' "$ACME_DEFAULT_EMAIL" >&2
      exit 1
    fi
    if [[ "$ACME_DEFAULT_EMAIL" =~ @(example\.com|example\.net|example\.org)$ ]]; then
      printf '\033[1;31m"%s" — LE отвергает example.* как forbidden test domain. Введи реальный.\033[0m\n' "$ACME_DEFAULT_EMAIL" >&2
      exit 1
    fi
    log "Email для ACME: ${ACME_DEFAULT_EMAIL}"
  else
    log "Email не указан — install-команды для Hysteria/Naive-нод будут с placeholder, заполнишь вручную"
  fi
  printf '\n'
fi

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
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" update -y
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" dist-upgrade -y
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" autoremove -y
fi

# ───── 2b. Firewall — open the bare minimum, then enable ─────
# Order matters: allow SSH FIRST so we don't lock ourselves out, only then
# flip the defaults to deny + enable.
if [[ "${SKIP_FIREWALL:-0}" != "1" ]]; then
  if ! command -v ufw >/dev/null; then
    "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y ufw
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
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y docker-compose-plugin
fi
log "Docker: $(docker --version)"
log "Compose: $(docker compose version)"

# ───── 3. Source checkout ─────
if [[ ! -d "$ICE_PANEL_DIR/.git" ]]; then
  log "Cloning $ICE_PANEL_REPO@$ICE_PANEL_REF into $ICE_PANEL_DIR"
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y git
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
  "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y openssl >/dev/null 2>&1 || true
  PG_PASSWORD=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  if [[ -n "$PANEL_DOMAIN" ]]; then
    CORS_ORIGIN_VAL=${CORS_ORIGIN:-https://${PANEL_DOMAIN}}
    PUBLIC_URL_VAL=${PUBLIC_URL:-https://${PANEL_DOMAIN}}
  else
    CORS_ORIGIN_VAL=${CORS_ORIGIN:-http://${PUBLIC_IP}:${FRONTEND_PORT}}
    PUBLIC_URL_VAL=${PUBLIC_URL:-http://${PUBLIC_IP}:${FRONTEND_PORT}}
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
PUBLIC_URL=${PUBLIC_URL_VAL}
FRONTEND_PORT=${FRONTEND_PORT}

# ───── Cycle #5/6 — security & alerts ─────
# TRUST_PROXY_HOPS: 2 = Cloudflare + Caddy (default deploy). Lower if
# you don't run CF in front. Higher = attackers can spoof X-Forwarded-For.
TRUST_PROXY_HOPS=2

# Per-route rate limits + login lockout (defaults are fine for small panel).
RATE_LIMIT_SUB_PER_MIN=30
RATE_LIMIT_BOOTSTRAP_PER_MIN=10
RATE_LIMIT_HEARTBEAT_PER_MIN=120
LOGIN_LOCKOUT_FAILURES=5
LOGIN_LOCKOUT_DURATION_MIN=15
LOGIN_LOCKOUT_WINDOW_MIN=15

# ACME contact email auto-injected into Hysteria/Naive install commands.
# Leave empty to make the UI emit a placeholder admin fills manually.
ACME_DEFAULT_EMAIL=${ACME_DEFAULT_EMAIL}

# Telegram alerts (Tier-1). Empty = disabled, set both to enable. See
# .env.production.example for what fires.
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Geo-block /api/* by CF-IPCountry. Empty = disabled. Requires Cloudflare
# orange-cloud + CF-IPCountry header.
ADMIN_ALLOWED_COUNTRIES=

# Honeypot scanner-trap blacklist TTL (seconds).
HONEYPOT_BLACKLIST_TTL_SEC=3600

# Honey-user tripwire: tokens admin plants in suspicious places. Any hit
# on /sub/<honey> fires Telegram alert + IP blacklist. CSV. Empty = disabled.
HONEY_USER_TOKENS=
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
    "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" update -y
    "${APT_ENV[@]}" apt-get "${APT_OPTS[@]}" install -y caddy
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
