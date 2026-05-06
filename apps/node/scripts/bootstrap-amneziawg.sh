#!/usr/bin/env bash
# Provision a fresh Ubuntu/Debian VPS to run an AmneziaWG inbound.
#
# Installation strategy:
#   Ubuntu 22.04 (jammy) and earlier: use ppa:amnezia/amneziawg (Launchpad)
#   Ubuntu 24.04 (noble) and later:   PPA doesn't register for noble, so we
#     install via DKMS from the upstream GitHub source + build awg-tools.
#
# Idempotent — safe to rerun.
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

# ───── 1. Distro check ─────
[[ -r /etc/os-release ]] || fail "Cannot read /etc/os-release; unsupported distro"
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian supported. Detected ID=${ID:-unknown}." ;;
esac
log "Detected $PRETTY_NAME"

# ───── 2. Prereqs ─────
log "Installing apt prereqs"
DEBIAN_FRONTEND=noninteractive apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  software-properties-common gnupg ca-certificates curl \
  build-essential dkms git libmnl-dev pkg-config wireguard-tools

KERNEL_VER=$(uname -r)
log "Running kernel: $KERNEL_VER"
DEBIAN_FRONTEND=noninteractive apt-get install -y "linux-headers-${KERNEL_VER}" || \
  warn "linux-headers-${KERNEL_VER} not found — DKMS build may fail"

# ───── 3. Kernel module via DKMS ─────
AWG_MODULE_REPO=https://github.com/amnezia-vpn/amneziawg-linux-kernel-module.git
AWG_MODULE_DIR=/usr/src/amneziawg-build

if lsmod | grep -q '^amneziawg\b'; then
  log "amneziawg kernel module already loaded — skipping module install"
else
  log "Installing amneziawg kernel module via DKMS from $AWG_MODULE_REPO"

  # Fresh clone or update
  if [[ -d "$AWG_MODULE_DIR/.git" ]]; then
    git -C "$AWG_MODULE_DIR" fetch --depth 1 origin main
    git -C "$AWG_MODULE_DIR" reset --hard origin/main
  else
    git clone --depth 1 "$AWG_MODULE_REPO" "$AWG_MODULE_DIR"
  fi

  # Parse version from dkms.conf
  AWG_VER=$(grep 'PACKAGE_VERSION' "$AWG_MODULE_DIR/dkms.conf" | head -1 | grep -oP '"[^"]+"' | tr -d '"')
  log "amneziawg module version: $AWG_VER"

  # Remove stale DKMS entries for this version if present
  dkms remove "amneziawg/${AWG_VER}" --all 2>/dev/null || true

  # Add, build, install
  cp -r "$AWG_MODULE_DIR" "/usr/src/amneziawg-${AWG_VER}"
  dkms add "amneziawg/${AWG_VER}"
  dkms build "amneziawg/${AWG_VER}"
  dkms install "amneziawg/${AWG_VER}"

  log "Loading amneziawg kernel module"
  modprobe amneziawg || warn "modprobe amneziawg failed — try rebooting"
fi

# ───── 4. AWG userspace tools ─────
AWG_TOOLS_REPO=https://github.com/amnezia-vpn/amneziawg-tools.git
AWG_TOOLS_DIR=/usr/src/amneziawg-tools-build

if command -v awg >/dev/null && command -v awg-quick >/dev/null; then
  log "awg tools already installed: $(awg --version 2>&1 | head -1)"
else
  log "Building amneziawg-tools from $AWG_TOOLS_REPO"

  if [[ -d "$AWG_TOOLS_DIR/.git" ]]; then
    git -C "$AWG_TOOLS_DIR" fetch --depth 1 origin master
    git -C "$AWG_TOOLS_DIR" reset --hard origin/master
  else
    git clone --depth 1 "$AWG_TOOLS_REPO" "$AWG_TOOLS_DIR"
  fi

  make -C "$AWG_TOOLS_DIR/src" -j"$(nproc)"
  make -C "$AWG_TOOLS_DIR/src" install

  log "awg: $(awg --version 2>&1 | head -1)"
  log "awg-quick: $(command -v awg-quick)"
fi

# ───── 5. Verify ─────
command -v awg     >/dev/null || fail "awg binary not found after install"
command -v awg-quick >/dev/null || fail "awg-quick binary not found after install"

DKMS_OK=true
if ! lsmod | grep -q '^amneziawg\b'; then
  warn "amneziawg module not loaded — DKMS build may have failed or reboot needed"
  DKMS_OK=false
fi

# ───── 6. IP forwarding ─────
SYSCTL_CONF=/etc/sysctl.d/99-awg.conf
if [[ ! -f "$SYSCTL_CONF" ]]; then
  log "Enabling IP forwarding"
  echo "net.ipv4.ip_forward=1" > "$SYSCTL_CONF"
  echo "net.ipv6.conf.all.forwarding=1" >> "$SYSCTL_CONF"
  sysctl --system >/dev/null
fi

# ───── 7. Summary ─────
echo
if $DKMS_OK; then
  log "AmneziaWG kernel-mode is ready."
  echo "    Module: $(modinfo amneziawg 2>/dev/null | grep '^version' | head -1 || echo 'loaded')"
else
  warn "Kernel module is NOT loaded. Try rebooting, then 'modprobe amneziawg'."
  warn "Or use amneziawg-go (userspace, ~30 Mbps): https://github.com/amnezia-vpn/amneziawg-go"
fi
