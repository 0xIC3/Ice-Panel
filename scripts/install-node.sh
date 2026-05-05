#!/usr/bin/env bash
# Ice-Panel node-agent one-command installer.
#
# What it does:
#   1. Verifies Go + git (installs them on Ubuntu/Debian if missing)
#   2. Clones repo into $ICE_NODE_DIR (default /opt/ice-panel-node)
#   3. Builds the static node-agent binary → /usr/local/bin/ice-panel-node
#   4. (per --protocol) chains the protocol-specific bootstrap:
#        hysteria   → installs official hysteria via get.hy2.sh
#        xray       → installs official xray via XTLS install-script
#        amneziawg  → runs apps/node/scripts/bootstrap-amneziawg.sh
#        naive      → runs apps/node/scripts/bootstrap-naive.sh (xcaddy + plugin)
#   5. Drops a systemd unit at /etc/systemd/system/ice-panel-node.service
#   6. Writes /etc/ice-panel-node/env with NODE_PAYLOAD + protocol env
#   7. Enables + starts the service, waits for /healthz
#
# Usage (as root):
#   bash <(curl -fsSL .../install-node.sh) --protocol hysteria --payload "<base64-blob>"
#
# Get the payload by creating a Node in the panel UI — copy the one-time blob
# shown in the modal.
#
# Re-runnable. Existing /etc/ice-panel-node/env is preserved unless --payload
# is given again.

set -euo pipefail

log()  { printf '\033[1;34m[install-node]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must run as root (sudo bash $0)"

ICE_NODE_DIR=${ICE_NODE_DIR:-/opt/ice-panel-node}
ICE_NODE_REPO=${ICE_NODE_REPO:-https://github.com/0xIC3/Ice-Panel.git}
ICE_NODE_REF=${ICE_NODE_REF:-main}
NODE_HOST=${NODE_HOST:-0.0.0.0}
NODE_PORT=${NODE_PORT:-8443}

PROTOCOL=""
PAYLOAD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --protocol) PROTOCOL="$2"; shift 2 ;;
    --payload)  PAYLOAD="$2"; shift 2 ;;
    --port)     NODE_PORT="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) fail "Unknown arg: $1" ;;
  esac
done

case "$PROTOCOL" in
  hysteria|xray|amneziawg|naive) ;;
  "") fail "Pass --protocol hysteria|xray|amneziawg|naive" ;;
  *)  fail "Unknown protocol: $PROTOCOL" ;;
esac

# ───── 1. Distro ─────
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian supported here" ;;
esac
log "Detected $PRETTY_NAME, protocol=$PROTOCOL"

# ───── 2. Prereqs ─────
log "Installing apt prereqs"
apt-get update -y
apt-get install -y git curl ca-certificates ufw

# ───── 3. Go ─────
NEED_GO=true
if command -v go >/dev/null; then
  CUR=$(go version | awk '{print $3}' | sed 's/^go//')
  if [[ "$(printf '%s\n' "1.22" "$CUR" | sort -V | head -1)" == "1.22" ]]; then
    NEED_GO=false
  fi
fi
if $NEED_GO; then
  GO_VERSION=${GO_VERSION:-1.23.4}
  ARCH=$(dpkg --print-architecture)
  case "$ARCH" in
    amd64) GO_ARCH=amd64 ;;
    arm64) GO_ARCH=arm64 ;;
    *) fail "Unsupported arch: $ARCH" ;;
  esac
  log "Installing Go $GO_VERSION"
  TMPDL=$(mktemp -d)
  curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz" -o "${TMPDL}/go.tar.gz"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf "${TMPDL}/go.tar.gz"
  rm -rf "$TMPDL"
fi
export PATH=/usr/local/go/bin:$PATH

# ───── 4. Source ─────
if [[ ! -d "$ICE_NODE_DIR/.git" ]]; then
  log "Cloning $ICE_NODE_REPO@$ICE_NODE_REF"
  git clone --depth 1 --branch "$ICE_NODE_REF" "$ICE_NODE_REPO" "$ICE_NODE_DIR"
else
  log "Updating existing checkout"
  git -C "$ICE_NODE_DIR" fetch --depth 1 origin "$ICE_NODE_REF"
  git -C "$ICE_NODE_DIR" reset --hard "origin/$ICE_NODE_REF" || true
fi

# ───── 5. Build node-agent binary ─────
log "Building node-agent (CGO_ENABLED=0, static binary)"
cd "$ICE_NODE_DIR/apps/node"
CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/local/bin/ice-panel-node .
chmod +x /usr/local/bin/ice-panel-node
log "ice-panel-node: $(file /usr/local/bin/ice-panel-node | head -c 80)..."

# ───── 6. Protocol bootstrap ─────
case "$PROTOCOL" in
  hysteria)
    if ! command -v hysteria >/dev/null; then
      log "Installing hysteria via get.hy2.sh"
      bash <(curl -fsSL https://get.hy2.sh/)
    else
      log "hysteria already present: $(hysteria version | head -1)"
    fi
    PROTO_BINARY=$(command -v hysteria)
    PROTO_CONFIG=/etc/hysteria/config.yaml
    ;;
  xray)
    if ! command -v xray >/dev/null; then
      log "Installing xray via XTLS install-script"
      bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
    else
      log "xray already present: $(xray version | head -1)"
    fi
    PROTO_BINARY=$(command -v xray)
    PROTO_CONFIG=/etc/xray/config.json
    ;;
  amneziawg)
    log "Chaining bootstrap-amneziawg.sh"
    bash "$ICE_NODE_DIR/apps/node/scripts/bootstrap-amneziawg.sh"
    PROTO_BINARY=""
    PROTO_CONFIG=""
    ;;
  naive)
    log "Chaining bootstrap-naive.sh"
    bash "$ICE_NODE_DIR/apps/node/scripts/bootstrap-naive.sh"
    PROTO_BINARY=/usr/local/bin/caddy-naive
    PROTO_CONFIG=/etc/caddy/Caddyfile
    ;;
esac

# ───── 7. Env file ─────
ENV_DIR=/etc/ice-panel-node
mkdir -p "$ENV_DIR"
ENV_FILE="$ENV_DIR/env"

# Honour --payload only if the env file doesn't exist OR the user passed one.
if [[ -n "$PAYLOAD" || ! -f "$ENV_FILE" ]]; then
  if [[ -z "$PAYLOAD" ]]; then
    fail "First-time install needs --payload <base64-blob> from panel"
  fi
  log "Writing $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
NODE_PAYLOAD=${PAYLOAD}
NODE_HOST=${NODE_HOST}
NODE_PORT=${NODE_PORT}
EOF
  case "$PROTOCOL" in
    hysteria)
      cat >> "$ENV_FILE" <<EOF
HYSTERIA_BINARY=${PROTO_BINARY}
HYSTERIA_CONFIG=${PROTO_CONFIG}
HYSTERIA_AUTH_HOST=127.0.0.1
HYSTERIA_AUTH_PORT=9000
EOF
      ;;
    xray)
      cat >> "$ENV_FILE" <<EOF
XRAY_BINARY=${PROTO_BINARY}
XRAY_CONFIG=${PROTO_CONFIG}
# Fill in once you create an Xray inbound in the panel:
# XRAY_REALITY_PRIVATE_KEY=
# XRAY_REALITY_SHORT_IDS=
# XRAY_REALITY_SERVER_NAMES=
# XRAY_REALITY_DEST=www.cloudflare.com:443
# XRAY_PORT=443
EOF
      ;;
    naive)
      cat >> "$ENV_FILE" <<EOF
NAIVE_BINARY=${PROTO_BINARY}
NAIVE_CONFIG=${PROTO_CONFIG}
EOF
      ;;
  esac
  chmod 600 "$ENV_FILE"
else
  log "$ENV_FILE exists — keeping current payload (pass --payload to overwrite)"
fi

# ───── 8. Firewall ─────
log "Opening firewall ports (ufw): SSH, panel-mTLS=$NODE_PORT/tcp, protocol-specific"
ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow "${NODE_PORT}/tcp" >/dev/null 2>&1 || true
case "$PROTOCOL" in
  hysteria)  ufw allow 443/udp  >/dev/null 2>&1 || true ;;
  xray)      ufw allow 443/tcp  >/dev/null 2>&1 || true ;;
  amneziawg) ufw allow 51820/udp >/dev/null 2>&1 || true ;;
  naive)     ufw allow 443/tcp 80/tcp >/dev/null 2>&1 || true ;;
esac

# ───── 9. systemd unit ─────
UNIT=/etc/systemd/system/ice-panel-node.service
log "Installing systemd unit at $UNIT"
cat > "$UNIT" <<EOF
[Unit]
Description=Ice-Panel node-agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/local/bin/ice-panel-node
Restart=always
RestartSec=5
LimitNOFILE=1048576
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/log /etc/hysteria /etc/xray /etc/amneziawg /etc/caddy
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ice-panel-node.service
systemctl restart ice-panel-node.service

# ───── 10. Wait for /healthz ─────
log "Waiting for /healthz on 127.0.0.1:${NODE_PORT} (up to 30s)"
ok=false
for i in $(seq 1 30); do
  if curl -sk --resolve "anything:${NODE_PORT}:127.0.0.1" "https://127.0.0.1:${NODE_PORT}/healthz" -o /dev/null 2>/dev/null; then
    ok=true
    break
  fi
  sleep 1
done
if ! $ok; then
  warn "/healthz didn't respond — check 'systemctl status ice-panel-node' and 'journalctl -u ice-panel-node -f'"
fi

# ───── 11. Done ─────
PUBLIC_IP=$(curl -fsSL https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
echo
log "🎉 Ice-Panel node-agent is running."
echo
echo "  Protocol:    $PROTOCOL"
echo "  Public IP:   $PUBLIC_IP"
echo "  mTLS port:   $NODE_PORT/tcp  (panel connects here)"
echo "  Env file:    $ENV_FILE  (chmod 600)"
echo "  Logs:        journalctl -u ice-panel-node -f"
echo "  Restart:     systemctl restart ice-panel-node"
echo
echo "Panel-side: in the Nodes tab, the new node should show 'connected' within"
echo "a few seconds after the panel attempts an mTLS handshake."
