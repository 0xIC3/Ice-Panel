#!/usr/bin/env bash
# Ice-Panel node-agent one-command installer.
#
# What it does:
#   1. Verifies Go + git (installs them on Ubuntu/Debian if missing)
#   2. Clones repo into $ICE_NODE_DIR (default /opt/ice-panel-node)
#   3. Builds the static node-agent binary → /usr/local/bin/ice-panel-node
#   4. (per --protocol) chains the protocol-specific bootstrap:
#        hysteria     → installs official hysteria via get.hy2.sh
#        xray         → installs official xray via XTLS install-script
#        amneziawg    → runs apps/node/scripts/bootstrap-amneziawg.sh
#        naive        → runs apps/node/scripts/bootstrap-naive.sh (xcaddy + plugin)
#        shadowsocks  → reuses xray-core (SS2022 multi-user runs inside xray)
#        mtproto      → runs apps/node/scripts/bootstrap-mtg.sh (9seconds/mtg)
#        mieru        → runs apps/node/scripts/bootstrap-mieru.sh (enfein/mieru)
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
# === ONE-COMMAND PROTOCOL SETUP ===
#
# For a fully-configured node — node-agent + protocol server + systemd unit
# + ACME cert — pass per-protocol flags. Otherwise install-node.sh installs
# the binaries and you have to drop config files manually.
#
# Hysteria 2 — auto-configure server with LE-issued cert + masquerade:
#   bash <(curl -fsSL .../install-node.sh) \
#     --panel-url https://panel.example.com \
#     --bootstrap bs_xxx \
#     --protocol hysteria \
#     --hysteria-domain hy2-01.example.com \
#     --hysteria-email admin@example.com
#   # Optional: --hysteria-masquerade-url https://en.wikipedia.org/
#   #           --hysteria-obfs-password <salamander-pwd>
#   #           --hysteria-port-range 20000-50000   (slice 31.5 port-hopping;
#   #             defeats RU TSPU UDP/443 throttle. Pass "" to disable.)
#
# Xray — pre-fill REALITY env so adapter starts immediately. Get keypair
# from the inbound creation form (panel UI → Inbounds → Create → Generate):
#   bash <(curl -fsSL .../install-node.sh) \
#     --panel-url https://panel.example.com \
#     --bootstrap bs_xxx \
#     --protocol xray \
#     --xray-reality-private-key sI_p9bg-7cy... \
#     --xray-reality-short-ids abc123 \
#     --xray-reality-server-names www.cloudflare.com \
#     --xray-reality-dest www.cloudflare.com:443
#   # Optional: --xray-port 443
#
# AmneziaWG / NaiveProxy — auto-config flags will land in slice 24 alongside
# panel-side auto-push. For now use --protocol amneziawg / --protocol naive
# and follow docs/deploy/install.md for per-protocol manual config steps.
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
#
# === RE-INSTALL / UNINSTALL ===
#
# When the panel is rebuilt, deleted-and-recreated, or you've registered the
# node fresh in the panel UI, the old server cert on the VPS won't validate
# against the new panel CA. Two flags handle this:
#
#   bash <(curl -fsSL .../install-node.sh) --reset \
#     --panel-url ... --bootstrap ... --protocol ...
#     # wipes prior state silently, then installs fresh
#
#   bash <(curl -fsSL .../install-node.sh) --uninstall
#     # stops + disables systemd unit, removes binary, /etc/ice-panel-node,
#     # /opt/ice-panel-node, and the UFW allow-rule for $NODE_PORT/tcp.
#     # Per-protocol services (xray.service, etc) are kept intact.
#
# Without either flag, an existing install triggers an interactive prompt.

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
RESET=0
UNINSTALL=0
# Slice S7 — UFW lock-down. When set, only this IP/CIDR (or comma-list)
# is allowed to reach :NODE_PORT. Without it the mTLS port is open to the
# whole internet — mTLS rejects everyone, but bots still spend our CPU on
# TLS handshakes and our agent leaks "I'm Ice-Panel" via the cert SAN.
PANEL_IP=""

# Hysteria 2 server config (only used with --protocol hysteria). When DOMAIN
# is given, the script writes /etc/hysteria/config.yaml + a hysteria systemd
# unit and starts the server — admin gets a fully-configured node from one
# command, no manual SSH editing.
HY_DOMAIN=""
HY_EMAIL=""
HY_MASQUERADE_URL="https://www.bing.com/"
HY_OBFS_PASSWORD=""
# Slice 31.5 — port-hopping. iptables NAT-REDIRECT for a UDP port range so
# clients can rotate destination ports per connection (mport=START-END in
# the URI). Defeats RU TSPU / IR / CN fixed-port UDP/443 throttle. The
# default range is wide enough to give clients lots of room without
# colliding with common service ports. Admin can narrow / widen via flag.
# The range here must be a SUPERSET of any per-profile range emitted in
# the panel — otherwise the panel-emitted ports rotate outside the
# iptables redirect and never reach hysteria.
HY_PORT_RANGE="20000-50000"

# Xray REALITY inbound params (only used with --protocol xray). When all the
# required ones are passed, they're written into /etc/ice-panel-node/env so
# the node-agent's xray adapter spawns a working REALITY listener at startup.
# Without these flags the Xray adapter stays disabled until the admin edits
# the env file manually (slice 24 will auto-push these from the panel).
XR_PRIVATE_KEY=""
XR_PUBLIC_KEY=""
XR_SHORT_IDS=""
XR_SERVER_NAMES="www.cloudflare.com"
XR_DEST="www.cloudflare.com:443"
XR_PORT="443"

# Resolve a payload value: if it starts with "@", treat the rest as a path
# and read the file content. Otherwise return as-is. Mirrors curl's `-d @file`
# convention. Critical for long payloads — Linux TTY canonical-mode buffer
# truncates pastes at 4096 bytes, so anything pasted directly into the
# terminal (or via `--payload "..."` with the user shell-pasting into the
# command line) gets cut. File-backed payload sidesteps the TTY entirely.
# Wipe everything install-node.sh creates: systemd unit, binary, source
# checkout, env dir, UFW allow-rule for the mTLS port, AND the per-
# protocol config the script generates (hysteria/xray service config).
# We deliberately keep upstream binaries (the `hysteria` / `xray` exes
# from their official installers) — only the config files, which are
# tied to the panel's domain/email/keys, get wiped so a re-install
# regenerates them cleanly. Idempotent — safe on a half-installed VPS.
do_uninstall() {
  log "Stopping ice-panel-node service (if running)"
  systemctl stop ice-panel-node 2>/dev/null || true
  systemctl disable ice-panel-node 2>/dev/null || true

  log "Removing systemd unit + drop-ins"
  rm -f /etc/systemd/system/ice-panel-node.service
  rm -rf /etc/systemd/system/ice-panel-node.service.d

  log "Stopping + removing protocol-specific services + their generated configs"
  for svc in hysteria xray; do
    systemctl stop "$svc" 2>/dev/null || true
    systemctl disable "$svc" 2>/dev/null || true
  done
  rm -f /etc/systemd/system/hysteria.service
  rm -rf /etc/systemd/system/hysteria.service.d
  rm -f /etc/hysteria/config.yaml
  rm -f /etc/xray/config.json

  # Slice 31.5 — port-hopping cleanup. Stopping the systemd unit fires
  # its ExecStop= which calls `ice-panel-hyhop down` to remove the
  # iptables rule. After that we can safely remove the script + unit.
  systemctl stop ice-panel-hyhop 2>/dev/null || true
  systemctl disable ice-panel-hyhop 2>/dev/null || true
  rm -f /etc/systemd/system/ice-panel-hyhop.service
  rm -f /usr/local/bin/ice-panel-hyhop
  systemctl daemon-reload || true

  log "Removing binary"
  rm -f /usr/local/bin/ice-panel-node

  log "Removing env directory (/etc/ice-panel-node)"
  rm -rf /etc/ice-panel-node

  log "Removing source checkout ($ICE_NODE_DIR)"
  rm -rf "$ICE_NODE_DIR"

  if command -v ufw >/dev/null && ufw status | grep -q "${NODE_PORT}/tcp"; then
    log "Removing UFW allow rule for ${NODE_PORT}/tcp"
    ufw --force delete allow "${NODE_PORT}/tcp" >/dev/null || true
  fi
}

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
    # Hysteria 2 — auto-configure server (config.yaml + systemd unit)
    --hysteria-domain)         HY_DOMAIN="$2"; shift 2 ;;
    --hysteria-email)          HY_EMAIL="$2"; shift 2 ;;
    --hysteria-masquerade-url) HY_MASQUERADE_URL="$2"; shift 2 ;;
    --hysteria-obfs-password)  HY_OBFS_PASSWORD="$2"; shift 2 ;;
    # Slice 31.5 — port-hopping iptables redirect range. Accepts
    # `START-END` (hyphen). Pass empty string to disable port-hopping
    # on this node (then iptables stays untouched).
    --hysteria-port-range)     HY_PORT_RANGE="$2"; shift 2 ;;
    # Xray REALITY — pre-fill env so the adapter starts immediately
    --xray-reality-private-key)  XR_PRIVATE_KEY="$2"; shift 2 ;;
    --xray-reality-public-key)   XR_PUBLIC_KEY="$2"; shift 2 ;;
    --xray-reality-short-ids)    XR_SHORT_IDS="$2"; shift 2 ;;
    --xray-reality-server-names) XR_SERVER_NAMES="$2"; shift 2 ;;
    --xray-reality-dest)         XR_DEST="$2"; shift 2 ;;
    --xray-port)                 XR_PORT="$2"; shift 2 ;;
    # Re-installation flow on a VPS that already hosts a previous agent:
    #   --reset      → wipe prior state silently before installing
    #   --uninstall  → wipe prior state and exit (no install)
    # Without either flag, a detected prior install triggers an interactive
    # "overwrite? [y/N]" prompt; non-interactive runs (no tty) abort.
    --reset)         RESET=1; shift ;;
    --uninstall)     UNINSTALL=1; shift ;;
    --panel-ip)      PANEL_IP="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) fail "Unknown arg: $1" ;;
  esac
done

# ───── -1. Uninstall fast-path ─────
# Run BEFORE bootstrap-token redemption — otherwise `--uninstall` would
# pointlessly consume a one-shot bootstrap token.
if [[ $UNINSTALL -eq 1 ]]; then
  if [[ -f /etc/ice-panel-node/env || -x /usr/local/bin/ice-panel-node ]]; then
    log "Uninstalling previous ice-panel-node …"
    do_uninstall
    log "✅ Uninstall complete. Rerun install-node.sh to set up a fresh agent."
  else
    log "Nothing to uninstall — no prior ice-panel-node found."
  fi
  exit 0
fi

# If both --panel-url and --bootstrap given, redeem the bootstrap token to
# fetch the full payload from panel over HTTP. This is the recommended flow
# — it sidesteps the 4 KB TTY paste limit because the long payload travels
# over a plain HTTP body, not through the user's shell.
if [[ -n "$BOOTSTRAP_TOKEN" && -n "$PANEL_URL" ]]; then
  log "Redeeming bootstrap token at $PANEL_URL"
  TMP_PAYLOAD=$(mktemp)
  # Cycle #6 fix 2026-05-12 — was `curl -f ... || echo 000`. `-f` makes curl
  # exit non-zero on HTTP 4xx/5xx, which triggered the `|| echo 000` and
  # appended "000" to whatever http_code -w already wrote → "410" became
  # "410000" and missed the case-410 branch, falling through to "*" with
  # the misleading "Unexpected HTTP 410000" message. Drop -f so curl exits 0
  # on every reply where the response was actually parsed (we use http_code
  # to distinguish); separate || fallback covers only the network-down
  # case where curl couldn't connect at all.
  HTTP_CODE=$(curl -sSL -o "$TMP_PAYLOAD" -w '%{http_code}' \
    "$PANEL_URL/api/internal/bootstrap/$BOOTSTRAP_TOKEN" 2>/dev/null) || HTTP_CODE="000"
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

  1) Xray          VLESS+REALITY+Vision (TCP/443, raw/xhttp/ws/grpc transports)
  2) Hysteria 2    UDP/443, QUIC, Brutal CC — best throughput on lossy links
  3) AmneziaWG     DPI-resistant WireGuard fork (needs kernel module + DKMS)
  4) NaiveProxy    Caddy fork with klzgrad/forwardproxy@naive (≥2 GB RAM build)
  5) Shadowsocks   SS2022 multi-user via xray-core (TCP+UDP/443, no separate bin)
  6) MTProto       Telegram-only proxy via 9seconds/mtg (Fake-TLS over TCP/443)
  7) Mieru         Stealth proxy via enfein/mieru (mita server, TCP+UDP)

EOF
  local choice
  while true; do
    read -rp "Select [1-7]: " choice </dev/tty || fail "no /dev/tty — pass --protocol explicitly"
    case "$choice" in
      1) PROTOCOL=xray;        break ;;
      2) PROTOCOL=hysteria;    break ;;
      3) PROTOCOL=amneziawg;   break ;;
      4) PROTOCOL=naive;       break ;;
      5) PROTOCOL=shadowsocks; break ;;
      6) PROTOCOL=mtproto;     break ;;
      7) PROTOCOL=mieru;       break ;;
      *) echo "  → invalid choice '$choice'; enter 1-7." ;;
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

# ───── 0. Existing-install handling ─────
# Detect a prior installation. The env file is the canonical marker — if
# it's there, the agent has at least been bootstrapped against *some*
# panel before. Re-using it against a different (or freshly-rebuilt)
# panel is the #1 source of "panel can't reach node" support tickets,
# because the old server cert won't validate against the new panel CA.
EXISTING_INSTALL=0
if [[ -f /etc/ice-panel-node/env || -x /usr/local/bin/ice-panel-node ]]; then
  EXISTING_INSTALL=1
fi

if [[ $EXISTING_INSTALL -eq 1 ]]; then
  if [[ $RESET -eq 1 ]]; then
    log "--reset given — wiping previous installation"
    do_uninstall
  elif [[ -e /dev/tty ]]; then
    warn "Detected previous ice-panel-node install on this VPS."
    warn "Re-installing against a different panel without wiping state will"
    warn "cause mTLS verification to fail (old server cert vs new panel CA)."
    # Cycle #6 reality-check 2026-05-12 — `read -rp "..." ans </dev/tty`
    # silently lost the keypress in the `bash <(curl ...)` process-substitution
    # flow (the prompt printed but the subsequent read returned empty, hitting
    # the `*` branch with "Aborted by user" even though `y` was typed). Splitting
    # the prompt print and the read fixes it — `read` then has /dev/tty as a
    # proper terminal handle without the prompt-print racing the input side.
    printf '\033[1;33mWipe previous installation and continue? [y/N]:\033[0m '
    if ! read -r ans </dev/tty; then
      ans=""
    fi
    case "${ans,,}" in
      y|yes) do_uninstall ;;
      *)     fail "Aborted by user. Pass --reset to skip this prompt, or --uninstall to remove without re-installing." ;;
    esac
  else
    fail "Previous install detected and no /dev/tty for prompt. Pass --reset to overwrite or --uninstall to remove."
  fi
fi

case "$PROTOCOL" in
  hysteria|xray|amneziawg|naive|shadowsocks|mtproto|mieru) ;;
  "")
    if [[ -e /dev/tty ]]; then
      prompt_protocol
    else
      fail "Pass --protocol hysteria|xray|amneziawg|naive|shadowsocks|mtproto|mieru (no /dev/tty for interactive menu)"
    fi
    ;;
  *)  fail "Unknown protocol: $PROTOCOL (valid: hysteria|xray|amneziawg|naive|shadowsocks|mtproto|mieru)" ;;
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

# Persist `go` in PATH for future SSH sessions — symlink into /usr/local/bin
# (which is on every distro's default PATH) so admins can rebuild the agent
# manually after a `git pull` without having to re-run install-node.sh.
ln -sf /usr/local/go/bin/go /usr/local/bin/go
ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt

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
    # XTLS installer creates its own xray.service that conflicts with our
    # node-agent's subprocess management. Disable it — ice-panel-node owns xray.
    systemctl stop xray.service  >/dev/null 2>&1 || true
    systemctl disable xray.service >/dev/null 2>&1 || true
    log "XTLS xray.service disabled — ice-panel-node manages xray directly"
    PROTO_BINARY=$(command -v xray)
    PROTO_CONFIG=/usr/local/etc/xray/config.json
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
  shadowsocks)
    # SS2022 multi-user runs INSIDE xray-core (slice 24d). No separate binary.
    # Reuse the xray install path; the SS adapter on the node-agent shells out
    # to its own xray-api inbound on 127.0.0.1:8081 (one above the VLESS
    # adapter's :8080 to avoid collision when both adapters live on one node).
    if ! command -v xray >/dev/null; then
      log "Installing xray (SS2022 runs inside xray-core)"
      bash -c "$(curl -fsSL https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
    else
      log "xray already present: $(xray version | head -1)"
    fi
    systemctl stop xray.service  >/dev/null 2>&1 || true
    systemctl disable xray.service >/dev/null 2>&1 || true
    log "XTLS xray.service disabled — ice-panel-node manages xray directly"
    PROTO_BINARY=$(command -v xray)
    PROTO_CONFIG=/etc/xray/shadowsocks.json
    ;;
  mtproto)
    log "Chaining bootstrap-mtg.sh"
    bash "$ICE_NODE_DIR/apps/node/scripts/bootstrap-mtg.sh"
    PROTO_BINARY=/usr/local/bin/mtg
    PROTO_CONFIG=/etc/mtg/config.toml
    ;;
  mieru)
    log "Chaining bootstrap-mieru.sh"
    bash "$ICE_NODE_DIR/apps/node/scripts/bootstrap-mieru.sh"
    PROTO_BINARY=/usr/local/bin/mita
    PROTO_CONFIG=/etc/mita/server.json
    ;;
esac

# ───── 7. Env file ─────
ENV_DIR=/etc/ice-panel-node
mkdir -p "$ENV_DIR"

# ProtectSystem=strict in our systemd unit makes /etc read-only except for
# explicit ReadWritePaths. ReadWritePaths can't *create* directories, only
# permit writes inside existing ones — so we pre-create every per-protocol
# config dir here, even if the protocol isn't installed on this node.
mkdir -p /etc/xray /etc/hysteria /etc/amneziawg /etc/caddy /etc/mtg /etc/mita
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
      # Pass domain + email through to the agent so subsequent ApplyInbound
      # pushes can rewrite the Hysteria config without losing identity.
      # Without these, the agent's hysteria adapter falls back to defaults
      # ("your.domain.net") on the next config write — exactly the bug we
      # just chased on the first ice-hys2-test install.
      if [[ -n "$HY_DOMAIN" ]]; then
        echo "HYSTERIA_HOSTNAME=${HY_DOMAIN}" >> "$ENV_FILE"
      fi
      if [[ -n "$HY_EMAIL" ]]; then
        echo "HYSTERIA_ACME_EMAIL=${HY_EMAIL}" >> "$ENV_FILE"
      fi
      # Tell the agent we're delegating hysteria's lifecycle to systemd
      # (the install just wrote /etc/systemd/system/hysteria.service).
      # Without this, the agent's adapter assumes "spawn-mode" and tries
      # to fork its own hysteria process — which then fights the systemd-
      # managed copy for :443/udp and dies with "address already in use".
      echo "HYSTERIA_SERVICE_UNIT=hysteria" >> "$ENV_FILE"
      # Cycle #6 reality-check 2026-05-12 — traffic API endpoint. Without
      # this hysteria-server doesn't expose per-user uplink/downlink and
      # the panel UI is stuck on "0 B today" for every Hysteria node even
      # under multi-MiB load. Generate a random secret here so adapter
      # (poller) and hysteria-server (validator) share the same value;
      # bind loopback-only so the endpoint is unreachable from outside.
      HYSTERIA_STATS_SECRET=$(openssl rand -hex 24 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '=+/' | head -c 48)
      {
        echo "HYSTERIA_STATS_LISTEN=127.0.0.1:9999"
        echo "HYSTERIA_STATS_SECRET=${HYSTERIA_STATS_SECRET}"
      } >> "$ENV_FILE"
      ;;
    xray)
      cat >> "$ENV_FILE" <<EOF
XRAY_BINARY=${PROTO_BINARY}
XRAY_CONFIG=${PROTO_CONFIG}
EOF
      if [[ -n "$XR_PRIVATE_KEY" && -n "$XR_SHORT_IDS" ]]; then
        cat >> "$ENV_FILE" <<EOF
XRAY_REALITY_PRIVATE_KEY=${XR_PRIVATE_KEY}
XRAY_REALITY_SHORT_IDS=${XR_SHORT_IDS}
XRAY_REALITY_SERVER_NAMES=${XR_SERVER_NAMES}
XRAY_REALITY_DEST=${XR_DEST}
XRAY_PORT=${XR_PORT}
EOF
        log "Xray REALITY env populated (port=${XR_PORT}, sni=${XR_SERVER_NAMES})"
      else
        cat >> "$ENV_FILE" <<EOF
# Fill in once you create an Xray inbound in the panel:
# XRAY_REALITY_PRIVATE_KEY=
# XRAY_REALITY_SHORT_IDS=
# XRAY_REALITY_SERVER_NAMES=
# XRAY_REALITY_DEST=www.cloudflare.com:443
# XRAY_PORT=443
EOF
      fi
      ;;
    naive)
      cat >> "$ENV_FILE" <<EOF
NAIVE_BINARY=${PROTO_BINARY}
NAIVE_CONFIG=${PROTO_CONFIG}
EOF
      ;;
    shadowsocks)
      # SS2022 multi-user is driven by xray-core; the SS adapter spawns its own
      # api-inbound at :8081 separate from the VLESS adapter at :8080.
      cat >> "$ENV_FILE" <<EOF
XRAY_BINARY=${PROTO_BINARY}
SHADOWSOCKS_CONFIG=${PROTO_CONFIG}
# Cipher (default 2022-blake3-aes-256-gcm). Override only if you have a
# legacy-client compatibility need.
# SHADOWSOCKS_METHOD=2022-blake3-aes-256-gcm
EOF
      ;;
    mtproto)
      cat >> "$ENV_FILE" <<EOF
MTG_BINARY=${PROTO_BINARY}
MTG_CONFIG=${PROTO_CONFIG}
MTG_PORT=443
MTG_STATS_PORT=3129
# Fake-TLS masquerade domain — must be a real, popular HTTPS host. Filled
# in via panel UI when you create the MTProto inbound; safe default below.
# MTG_DOMAIN=www.cloudflare.com
EOF
      ;;
    mieru)
      cat >> "$ENV_FILE" <<EOF
MITA_BINARY=${PROTO_BINARY}
MITA_CONFIG=${PROTO_CONFIG}
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
  # Slice S7 — restrict mTLS port to the panel's IP if --panel-ip given,
  # otherwise (--panel-ip not set) fall back to world-open with a loud warn.
  # Resolving --panel-url's host into a candidate IP would help, but DNS
  # changes (CF rotations, panel migrations) would silently break the
  # control plane — we'd rather make the operator type it explicitly.
  if [[ -n "$PANEL_IP" ]]; then
    log "Restricting :${NODE_PORT}/tcp to PANEL_IP=$PANEL_IP (use comma-list for multiple)"
    IFS=',' read -ra _PANEL_IPS <<< "$PANEL_IP"
    for ip in "${_PANEL_IPS[@]}"; do
      ufw allow from "${ip// /}" to any port "$NODE_PORT" proto tcp >/dev/null 2>&1 || true
    done
    unset _PANEL_IPS
  else
    warn "no --panel-ip given — mTLS port :${NODE_PORT}/tcp opened to the WORLD."
    warn "mTLS still rejects unknown clients, but you waste CPU on bot handshakes"
    warn "and leak 'this is Ice-Panel' via the server cert SAN. Pass --panel-ip <ip>"
    warn "next time (panel public IP) to lock it down. You can also fix it now:"
    warn "  ufw delete allow ${NODE_PORT}/tcp; ufw allow from <panel-ip> to any port ${NODE_PORT} proto tcp"
    ufw allow "${NODE_PORT}/tcp"           >/dev/null 2>&1 || true
  fi
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
    shadowsocks)
      # SS2022 listens on TCP+UDP; UDP needed for relay (DNS/QUIC/realtime).
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ufw allow 443/udp                  >/dev/null 2>&1 || true
      ;;
    mtproto)
      # mtg Fake-TLS handshake mimics HTTPS — TCP/443 is the canonical port.
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ;;
    mieru)
      # mita supports either TCP or UDP transport per port-binding entry.
      # Allow both; firewall extras can be tightened post-install.
      ufw allow 443/tcp                  >/dev/null 2>&1 || true
      ufw allow 443/udp                  >/dev/null 2>&1 || true
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
# Slice 38 — heartbeat self-destruct exits with code 42 to signal "panel
# disowned this node, don't restart me." Any other exit (crash, panic,
# ENV typo, transient OOM-kill) goes through Restart=always as before.
RestartPreventExitStatus=42
LimitNOFILE=1048576
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=-/var/log -/etc/ice-panel-node -/etc/hysteria -/etc/xray -/usr/local/etc/xray -/etc/amneziawg -/etc/caddy -/etc/mtg -/etc/mita -/var/lib/mita
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

# ───── 9b. Hysteria server config (auto-configure when domain given) ─────
# When admin passes --hysteria-domain + --hysteria-email, we lay down a full
# Hysteria 2 server config and systemd unit. Without this, the admin would
# have to SSH in and write /etc/hysteria/config.yaml by hand after running
# install-node.sh — caught during the 2026-05-06 VPS test as a friction
# point. Skipped silently if either flag is missing or if the protocol
# isn't hysteria.
if [[ "$PROTOCOL" == "hysteria" && -n "$HY_DOMAIN" && -n "$HY_EMAIL" ]]; then
  HY_CONFIG=/etc/hysteria/config.yaml

  # Cycle #6 reality-check (2026-05-12): the official get.hy2.sh script
  # that runs earlier in this installer writes a placeholder config.yaml
  # with `your.domain.net` / `your@email.com` BEFORE we get here. The
  # previous "skip if file exists" behaviour then kept that placeholder
  # and silently ignored the admin's --hysteria-domain / --hysteria-email
  # flags — hysteria came up trying to obtain a cert for `your.domain.net`
  # and crashlooped. Detect the placeholder pattern and overwrite when
  # we have real values to write; only skip when the existing config
  # already mentions OUR domain (genuine admin-customized state).
  SHOULD_WRITE_CFG=1
  if [[ -f "$HY_CONFIG" ]]; then
    if grep -q "${HY_DOMAIN}" "$HY_CONFIG"; then
      SHOULD_WRITE_CFG=0
      log "Hysteria config already mentions ${HY_DOMAIN} — keeping admin-customized state"
    else
      log "Hysteria config at $HY_CONFIG exists but doesn't reference ${HY_DOMAIN} (likely placeholder from get.hy2.sh) — overwriting"
    fi
  fi
  if [[ $SHOULD_WRITE_CFG -eq 1 ]]; then
    log "Writing Hysteria 2 server config at $HY_CONFIG (domain=$HY_DOMAIN)"
    {
      cat <<EOF
listen: :443

acme:
  domains:
    - ${HY_DOMAIN}
  email: ${HY_EMAIL}

auth:
  type: http
  http:
    url: http://127.0.0.1:9000/auth
    insecure: true

masquerade:
  type: proxy
  proxy:
    url: ${HY_MASQUERADE_URL}
    rewriteHost: true

bandwidth:
  up: 1 gbps
  down: 1 gbps

# Cycle #5 ground truth: clients (Hiddify iOS, NekoBox, Streisand) often
# negotiate up=0 with Brutal CC at session start, leading to "tunnel
# handshakes but tx=0, websites don't load". Forcing BBR here removes
# the dependency on a sane client-side bandwidth declaration. Clients
# that DO emit valid upmbps/downmbps via subscription URI still benefit
# from Brutal because we re-render this section on ApplyInbound from
# the panel.
ignoreClientBandwidth: true

# Cycle #6 traffic stats endpoint. Bind loopback-only so it isn't
# reachable from outside; the agent polls it from the same host with
# the matching secret from /etc/ice-panel-node/env (HYSTERIA_STATS_SECRET).
# Without this block, the agent's GetStats returns zero counters and
# the panel UI shows "0 B today" for every Hysteria node.
trafficStats:
  listen: 127.0.0.1:9999
  secret: ${HYSTERIA_STATS_SECRET}
EOF
      if [[ -n "$HY_OBFS_PASSWORD" ]]; then
        cat <<EOF

obfs:
  type: salamander
  salamander:
    password: ${HY_OBFS_PASSWORD}
EOF
      fi
    } > "$HY_CONFIG"
    chmod 600 "$HY_CONFIG"
  fi

  # Also disable get.hy2.sh's own systemd unit so its placeholder config
  # never gets picked up by a parallel service. Our hysteria.service
  # below owns the runtime.
  systemctl disable --now hysteria-server.service 2>/dev/null || true
  systemctl disable --now hysteria-server@.service 2>/dev/null || true

  HY_UNIT=/etc/systemd/system/hysteria.service
  if [[ ! -f "$HY_UNIT" ]]; then
    log "Installing Hysteria 2 systemd unit at $HY_UNIT"
    cat > "$HY_UNIT" <<EOF
[Unit]
Description=Hysteria 2 server
After=network-online.target ice-panel-node.service
Wants=network-online.target ice-panel-node.service

[Service]
Type=simple
ExecStart=/usr/local/bin/hysteria server -c ${HY_CONFIG}
Restart=always
RestartSec=5
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
  fi
  # ───── IPv6 sanity-check for hysteria's outbound resolver ─────
  # Cycle #5 finding: many VPS providers route IPv4 cleanly but leave IPv6
  # half-configured (AAAA records resolve, but the host can't actually reach
  # IPv6 destinations). Hysteria proxies a client-requested DNS name and
  # Go's net resolver tries IPv6 first by default — when AAAA wins, every
  # request times out at the v6 hop and the user sees "client connected
  # but YouTube doesn't load." Force IPv4 preference via gai.conf so the
  # libc resolver returns A records first; IPv6 still works if it works,
  # this just demotes it from the default winner.
  if ! grep -q '^precedence ::ffff:0:0/96  100' /etc/gai.conf 2>/dev/null; then
    log "Configuring /etc/gai.conf to prefer IPv4 for hysteria's outbound resolver"
    echo 'precedence ::ffff:0:0/96  100' >> /etc/gai.conf
  fi

  systemctl enable hysteria.service >/dev/null 2>&1 || true
  systemctl restart hysteria.service
  log "Hysteria 2 started — first run will obtain the LE certificate via HTTP-01"

  # ───── Slice 31.5 — Hysteria port-hopping (iptables REDIRECT) ─────
  # We install a tiny up/down helper + systemd unit that owns a single
  # NAT-PREROUTING rule redirecting `udp --dport START:END → :443`. The
  # unit is `Type=oneshot RemainAfterExit=yes` with ExecStart=up and
  # ExecStop=down so `systemctl stop` cleanly tears the rule down. The
  # rule is also restored on every boot (WantedBy=multi-user.target).
  #
  # We only install when:
  #   1. PROTOCOL=hysteria   (port-hopping is hysteria-specific)
  #   2. HY_PORT_RANGE is non-empty (admin can pass "" to opt out)
  #   3. iptables is present on the system
  if [[ -n "$HY_PORT_RANGE" ]] && command -v iptables >/dev/null 2>&1; then
    # Validate format BEFORE we substitute the value into the generated
    # helper script — the script runs as root and a careless typo (or a
    # tampered upstream install pipeline) would otherwise get baked in
    # verbatim. Format: `START-END` where both are 1024..65535 and END>START.
    if ! [[ "$HY_PORT_RANGE" =~ ^([0-9]{4,5})-([0-9]{4,5})$ ]]; then
      fail "--hysteria-port-range must be START-END (1024..65535), got: $HY_PORT_RANGE"
    fi
    HY_PR_START="${BASH_REMATCH[1]}"
    HY_PR_END="${BASH_REMATCH[2]}"
    if (( HY_PR_START < 1024 || HY_PR_END > 65535 || HY_PR_END <= HY_PR_START )); then
      fail "--hysteria-port-range out of bounds: $HY_PORT_RANGE (need 1024<start<end<=65535)"
    fi
    # iptables takes the range as `START:END` (colon). The flag we accept
    # is `START-END` (hyphen) so it matches the URI form admins see.
    HY_RANGE_IPT="${HY_PR_START}:${HY_PR_END}"
    HY_LISTEN_PORT=443
    HYHOP_BIN=/usr/local/bin/ice-panel-hyhop
    HYHOP_UNIT=/etc/systemd/system/ice-panel-hyhop.service

    log "Installing port-hopping iptables redirect: udp ${HY_PORT_RANGE} → ${HY_LISTEN_PORT}"

    cat > "$HYHOP_BIN" <<EOF
#!/usr/bin/env bash
# Ice-Panel Hysteria 2 port-hopping helper. Managed by systemd unit
# ice-panel-hyhop.service — do not edit by hand. To change the range,
# re-run install-node.sh with --hysteria-port-range START-END.
set -euo pipefail
RANGE_IPT='${HY_RANGE_IPT}'
LISTEN_PORT=${HY_LISTEN_PORT}
case "\${1:-}" in
  up)
    iptables -t nat -C PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" 2>/dev/null \\
      || iptables -t nat -A PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT"
    if command -v ip6tables >/dev/null 2>&1; then
      ip6tables -t nat -C PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" 2>/dev/null \\
        || ip6tables -t nat -A PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" \\
        || true
    fi
    ;;
  down)
    iptables -t nat -D PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" 2>/dev/null || true
    if command -v ip6tables >/dev/null 2>&1; then
      ip6tables -t nat -D PREROUTING -p udp --dport "\$RANGE_IPT" -j REDIRECT --to-ports "\$LISTEN_PORT" 2>/dev/null || true
    fi
    ;;
  *)
    echo "usage: \$0 up|down" >&2
    exit 64
    ;;
esac
EOF
    chmod 755 "$HYHOP_BIN"

    cat > "$HYHOP_UNIT" <<EOF
[Unit]
Description=Ice-Panel Hysteria 2 port-hopping (UDP ${HY_PORT_RANGE} → :${HY_LISTEN_PORT})
After=network-online.target hysteria.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${HYHOP_BIN} up
ExecStop=${HYHOP_BIN} down

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable ice-panel-hyhop.service >/dev/null 2>&1 || true
    systemctl restart ice-panel-hyhop.service
    log "Port-hopping active. Profile-side range MUST be a subset of ${HY_PORT_RANGE}."
  else
    [[ -z "$HY_PORT_RANGE" ]] && log "Port-hopping disabled by --hysteria-port-range ''"
    command -v iptables >/dev/null 2>&1 || warn "iptables not installed — skipping port-hopping setup"
  fi
elif [[ "$PROTOCOL" == "hysteria" ]]; then
  warn "Hysteria server NOT auto-configured — pass --hysteria-domain <fqdn> --hysteria-email <addr> next time"
  warn "Or manually write /etc/hysteria/config.yaml + systemd unit as documented in docs/deploy/install.md"
fi

# ───── 10. Wait for agent to be ready ─────
# Cycle #6 (2026-05-12) — was a curl probe to /healthz, but S6 hardening
# (cycle #5) added mTLS client-cert verification on the agent's HTTPS
# server. The probe never presented a client cert, so it always reported
# "didn't respond" even though the agent was perfectly healthy. We now
# ask systemd directly: "is the unit active and not failing?" — which
# is the right question anyway (the agent's mTLS health is a panel-side
# concern, not an install-time one). Logs flooded with
# `tls: client didn't provide a certificate` from the curl loop also
# go away with this change.
log "Waiting for ice-panel-node to be active (up to 30s)"
ok=false
for i in $(seq 1 30); do
  if systemctl is-active --quiet ice-panel-node 2>/dev/null; then
    # Also make sure it's not in a fast crashloop — any failures recorded
    # since boot would suggest the unit started but immediately died.
    if ! systemctl is-failed --quiet ice-panel-node 2>/dev/null; then
      ok=true
      break
    fi
  fi
  sleep 1
done
if $ok; then
  log "ice-panel-node is active. Panel will start polling over mTLS within ~30s."
else
  warn "ice-panel-node did NOT reach active state — check 'systemctl status ice-panel-node' and 'journalctl -u ice-panel-node -f'"
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
