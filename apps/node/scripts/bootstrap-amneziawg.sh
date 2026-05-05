#!/usr/bin/env bash
# Provision a fresh Ubuntu/Debian VPS to run an AmneziaWG inbound.
#
# Installs amneziawg + amneziawg-tools + amneziawg-dkms from the upstream PPA,
# loads the kernel module, and verifies the toolchain. Idempotent — safe to
# rerun. On DKMS build failure (common on ARM containers, custom kernels),
# falls back to suggesting the userspace amneziawg-go binary.
#
# Usage:  sudo bash bootstrap-amneziawg.sh
set -euo pipefail

log()  { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Must be run as root (sudo bash $0)"

# ───── 1. Distro check ─────
if [[ ! -r /etc/os-release ]]; then
  fail "Cannot read /etc/os-release; unsupported distro"
fi
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "Only Ubuntu/Debian are supported here. Detected ID=${ID:-unknown}. For RHEL/Fedora use the COPR repo (kaymes/amneziawg)." ;;
esac
log "Detected $PRETTY_NAME"

# ───── 2. Prereqs ─────
log "Installing apt prereqs (software-properties-common, gnupg)"
DEBIAN_FRONTEND=noninteractive apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  software-properties-common gnupg ca-certificates curl

# ───── 3. AmneziaWG PPA ─────
PPA_LIST=/etc/apt/sources.list.d/amnezia-ubuntu-amneziawg-*.list
if compgen -G "$PPA_LIST" > /dev/null; then
  log "AmneziaWG PPA already configured"
else
  log "Adding ppa:amnezia/amneziawg"
  add-apt-repository -y ppa:amnezia/amneziawg
fi
DEBIAN_FRONTEND=noninteractive apt-get update -y

# ───── 4. Install ─────
KERNEL_VER=$(uname -r)
log "Installing amneziawg packages (running kernel: $KERNEL_VER)"
DKMS_OK=true
if ! DEBIAN_FRONTEND=noninteractive apt-get install -y \
    amneziawg amneziawg-tools amneziawg-dkms "linux-headers-${KERNEL_VER}" 2>&1; then
  warn "DKMS build failed — kernel module won't load. amneziawg-tools is still installed."
  DKMS_OK=false
fi

# ───── 5. Module check ─────
if $DKMS_OK; then
  if lsmod | grep -q '^amneziawg\b'; then
    log "amneziawg kernel module already loaded"
  else
    log "Loading amneziawg kernel module"
    if modprobe amneziawg; then
      log "Module loaded"
    else
      warn "modprobe amneziawg failed. DKMS may not have produced a module for this kernel."
      DKMS_OK=false
    fi
  fi
fi

# ───── 6. Toolchain verify ─────
if ! command -v awg >/dev/null; then
  fail "awg binary not found after install. Aborting."
fi
log "awg version: $(awg --version 2>&1 | head -1)"
log "awg-quick:   $(awg-quick --version 2>&1 | head -1 || echo 'present')"

# ───── 7. Summary ─────
echo
if $DKMS_OK; then
  log "✅ AmneziaWG kernel-mode is ready."
  echo "    Throughput: ~kernel-native (90+ Mbps on 1 vCPU VPS)."
else
  warn "⚠ Kernel module is NOT loaded. Two options:"
  echo "    1. Reboot — sometimes DKMS finishes after a reboot."
  echo "    2. Fall back to userspace: install 'amneziawg-go' (Go reimplementation)."
  echo "       Throughput drops to ~30 Mbps but works without kernel module."
  echo "       https://github.com/amnezia-vpn/amneziawg-go"
fi
echo
echo "Next steps:"
echo "  - sysctl: enable IP forwarding -> 'echo net.ipv4.ip_forward=1 > /etc/sysctl.d/99-awg.conf && sysctl --system'"
echo "  - Open the inbound's UDP port in the firewall (default: ufw allow 51820/udp)"
echo "  - Start the ice-panel node-agent — it will manage the awg interface(s) via 'awg syncconf'."
