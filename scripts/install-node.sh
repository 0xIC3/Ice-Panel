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
# Usage (as root). RECOMMENDED — bootstrap-token flow (single command, no
# manual file transfer needed):
#
#   bash <(curl -fsSL .../install-node.sh) \
#     --panel-url https://panel.example.com \
#     --bootstrap bs_AbC123dEf456 \
#     --protocol xray
#
# Get the bootstrap token + ready-made command by clicking "Create node"
# in the panel UI — the modal shows a copy-pastable single-liner. Token is
# valid 15 min, single-use; if it expires, click "Refresh bootstrap" in
# the panel UI to mint a new one.
#
# Alternative flows (file-based — for air-gapped or self-hosted gist setups):
#   bash <(curl -fsSL .../install-node.sh) --protocol xray --payload-file /tmp/payload.b64
#   bash <(curl -fsSL .../install-node.sh) --protocol xray --payload "@/tmp/payload.b64"
#
# Or interactive:
#   bash <(curl -fsSL .../install-node.sh)
# (asks for protocol, then payload — accepts `@/path/to/file` syntax).
#
# **Don't paste the raw payload string into the terminal directly.** Linux
# TTY canonical-mode truncates pastes at 4096 bytes; real payloads are ~6-7
# KB, so the tail gets silently dropped and the node fails with a confusing
# `json unmarshal: unexpected end of JSON input`.
#
# Re-runnable. Existing /etc/ice-panel-node/env is preserved unless --payload
# (or --payload-file or --bootstrap) is given again.

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
PANEL_URL=""
BOOTSTRAP_TOKEN=""

# Resolve a payload value: if it starts with "@", treat the rest as a path
# and read the file content. Otherwise return as-is. Mirrors curl's `-d @file`
# convention. Critical for long payloads — Linux TTY canonical-mode buffer
# truncates pastes at 4096 bytes, so anything pasted directly into the
# terminal (or via `--payload "..."` with the user shell-pasting into the
# command line) gets cut. File-backed payload sidesteps the TTY entirely.
resolve_payload() {
  local value="$1"
  if [[ "$value" == @* ]]; then
    local path="${value#@}"
    [[ -r "$path" ]] || fail "Cannot read payload file: $path"
    # Strip any whitespace/newlines a careless save might leave in the file.
    tr -d '\n\r \t' < "$path"
  else
    printf '%s' "$value"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --protocol)      PROTOCOL="$2"; shift 2 ;;
    --payload)       PAYLOAD=$(resolve_payload "$2"); shift 2 ;;
    --payload-file)  PAYLOAD=$(resolve_payload "@$2"); shift 2 ;;
    --panel-url)     PANEL_URL="${2%/}"; shift 2 ;;
    --bootstrap)     BOOTSTRAP_TOKEN="$2"; shift 2 ;;
    --port)          NODE_PORT="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) fail "Unknown arg: $1" ;;
  esac
done

# If both --panel-url and --bootstrap given, redeem the bootstrap token to
# fetch the full payload from panel over HTTP. This is the recommended flow
# — it sidesteps the 4 KB TTY paste limit because the long payload travels
# over a plain HTTP body, not through the user's shell.
if [[ -n "$BOOTSTRAP_TOKEN" && -n "$PANEL_URL" ]]; then
  log "Redeeming bootstrap token at $PANEL_URL"
  TMP_PAYLOAD=$(mktemp)
  HTTP_CODE=$(curl -fsSL -o "$TMP_PAYLOAD" -w '%{http_code}' \
    "$PANEL_URL/api/internal/bootstrap/$BOOTSTRAP_TOKEN" || echo "000")
  case "$HTTP_CODE" in
    200) PAYLOAD=$(tr -d '\n\r \t' < "$TMP_PAYLOAD"); rm -f "$TMP_PAYLOAD" ;;
    404) rm -f "$TMP_PAYLOAD"; fail "Bootstrap token not found at $PANEL_URL — typo or expired+purged" ;;
    410) rm -f "$TMP_PAYLOAD"; fail "Bootstrap token already consumed or expired — issue a fresh one in the panel UI" ;;
    000) rm -f "$TMP_PAYLOAD"; fail "Cannot reach panel at $PANEL_URL — check the URL, TLS cert, firewall" ;;
    *)   rm -f "$TMP_PAYLOAD"; fail "Unexpected HTTP $HTTP_CODE from panel — see panel logs" ;;
  esac
  log "Bootstrap successful — fetched ${#PAYLOAD} bytes of payload"
elif [[ -n "$BOOTSTRAP_TOKEN" || -n "$PANEL_URL" ]]; then
  fail "--panel-url and --bootstrap must be passed TOGETHER (got only one)"
fi

prompt_protocol() {
  cat <<'EOF'

Pick a protocol for this node (one protocol per VPS is the recommended
pattern — resource isolation, simpler firewall):

  1) Xray         VLESS+REALITY+Vision (TCP/443, transports raw/xhttp/ws/grpc)
  2) Hysteria 2   UDP/443, QUIC, Brutal CC — best throughput on lossy links
  3) AmneziaWG    DPI-resistant WireGuard fork (needs kernel module, best
                  throughput when DKMS works)
  4) NaiveProxy   Caddy fork with klzgrad/forwardproxy@naive (needs ≥2 GB RAM
                  for the xcaddy build; no per-user stats)

EOF
  local choice
  while true; do
    read -rp "Select [1-4]: " choice </dev/tty || fail "no /dev/tty — pass --protocol explicitly"
    case "$choice" in
      1) PROTOCOL=xray;       break ;;
      2) PROTOCOL=hysteria;   break ;;
      3) PROTOCOL=amneziawg;  break ;;
      4) PROTOCOL=naive;      break ;;
      *) echo "  → invalid choice '$choice'; enter 1-4." ;;
    esac
  done
  log "Selected protocol: $PROTOCOL"
}

prompt_payload() {
  cat <<'EOF'

The panel issued a one-time base64 payload when you created this Node — it
contains the mTLS keypair. Find it in the panel UI: Nodes → Create node →
the modal that pops up after submit.

Two ways to enter it here:

  1. Paste the base64 string directly. WORKS ONLY for payloads under
     ~4 KB — Linux TTY truncates longer pastes at 4096 bytes. Real
     payloads are ~6-7 KB, so this almost never works.

  2. Save the payload to a file first (download via panel UI button, or
     scp from your laptop, or `cat > /tmp/payload.b64` if your terminal
     allows). Then enter `@/path/to/file` here — the script reads the
     file content directly without any TTY buffering.

EOF
  local input
  read -rp "Payload (or @/path/to/file): " input </dev/tty || fail "no /dev/tty — pass --payload explicitly"
  PAYLOAD=$(resolve_payload "$input")
  if [[ -z "$PAYLOAD" ]]; then
    fail "empty payload"
  fi
  # Sanity-check length: real payload is base64 of a ~3 KB JSON, so ≥4 KB
  # base64. Anything shorter is almost certainly truncated and we'll fail
  # later with a confusing JSON-decode error. Loudly warn now.
  if [[ ${#PAYLOAD} -lt 4000 ]]; then
    warn "payload is only ${#PAYLOAD} chars — typical payloads are 6-7 KB."
    warn "If you pasted directly into the terminal, you likely hit the 4096-byte"
    warn "TTY paste limit. Re-run with --payload @/path/to/file for the full thing."
  fi
}

case "$PROTOCOL" in
  hysteria|xray|amneziawg|naive) ;;
  "")
    if [[ -e /dev/tty ]]; then
      prompt_protocol
    else
      fail "Pass --protocol hysteria|xray|amneziawg|naive (no /dev/tty for interactive menu)"
    fi
    ;;
  *)  fail "Unknown protocol: $PROTOCOL (valid: hysteria|xray|amneziawg|naive)" ;;
esac

# ───── 1. Distro ─────
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian supported here" ;;
esac
log "Detected $PRETTY_NAME, protocol=$PROTOCOL"

# ───── 2a. OS upgrade ─────
# Pull pending security + package updates before laying down node-agent.
# Skip with SKIP_OS_UPGRADE=1 on a freshly-built image.
if [[ "${SKIP_OS_UPGRADE:-0}" != "1" ]]; then
  log "Upgrading OS packages (apt-get update + dist-upgrade)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" \
          dist-upgrade -y
  apt-get autoremove -y
fi

# ───── 2b. Prereqs ─────
log "Installing apt prereqs"
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
    if [[ -e /dev/tty ]]; then
      prompt_payload
    else
      fail "First-time install needs --payload <base64-blob> from panel (no /dev/tty for interactive prompt)"
    fi
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

# ───── 8. Firewall — allow exactly what's needed, deny the rest ─────
# Allow SSH FIRST so enabling ufw can't lock us out, then per-protocol ports,
# then flip defaults to deny + enable. Skip with SKIP_FIREWALL=1.
if [[ "${SKIP_FIREWALL:-0}" != "1" ]]; then
  log "Configuring firewall (ufw): SSH + panel-mTLS:$NODE_PORT + protocol-specific"
  ufw allow 22/tcp                       >/dev/null 2>&1 || true
  ufw allow "${NODE_PORT}/tcp"           >/dev/null 2>&1 || true
  case "$PROTOCOL" in
    hysteria)
      ufw allow 443/udp                  >/dev/null 2>&1 || true
      ufw allow 80/tcp                   >/dev/null 2>&1 || true  # ACME HTTP-01 (one-time)
      ;;
    xray)
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ;;
    amneziawg)
      ufw allow 51820/udp                >/dev/null 2>&1 || true
      ;;
    naive)
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ufw allow 80/tcp                   >/dev/null 2>&1 || true  # Caddy ACME
      ;;
  esac
  ufw default deny incoming  >/dev/null
  ufw default allow outgoing >/dev/null
  ufw --force enable         >/dev/null
  log "ufw status: $(ufw status | head -1)"
fi

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
ReadWritePaths=-/var/log -/etc/hysteria -/etc/xray -/etc/amneziawg -/etc/caddy
PrivateTmp=true

# Journald log limits — without these a node running for months can balloon
# /var/log/journal toward the disk-fill threshold. Cap roughly at ~50 MB
# total for this unit, age out older entries first.
LogRateLimitIntervalSec=30s
LogRateLimitBurst=10000

[Install]
WantedBy=multi-user.target
EOF

# Cap journald disk use globally to keep small VPS images alive.
JOURNALD_DROPIN=/etc/systemd/journald.conf.d/ice-panel-cap.conf
mkdir -p "$(dirname "$JOURNALD_DROPIN")"
if [[ ! -f "$JOURNALD_DROPIN" ]]; then
  log "Capping journald disk use at 200 MB (drop-in $JOURNALD_DROPIN)"
  cat > "$JOURNALD_DROPIN" <<'EOF'
[Journal]
SystemMaxUse=200M
SystemMaxFileSize=20M
MaxRetentionSec=2week
EOF
  systemctl restart systemd-journald
fi

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
echo "  Env file:    $ENV_FILE  (chmod 600 — keep it secret)"
echo
echo "Verify health (mimics what the panel does on every poll):"
echo "  curl -sk https://127.0.0.1:${NODE_PORT}/healthz | head -c 200"
echo
echo "Live logs (with timestamps, like 'docker compose logs -f -t'):"
echo "  journalctl -u ice-panel-node -f -o short-iso"
echo
echo "Restart / stop / status:"
echo "  systemctl restart ice-panel-node"
echo "  systemctl status  ice-panel-node"
echo
echo "Panel-side: refresh the Nodes tab — the new node flips to 'connected'"
echo "within a few seconds of the panel issuing its first mTLS healthcheck."
