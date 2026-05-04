---
name: AmneziaWG reference for Slice 19 AmneziaWGAdapter
description: Most complex adapter. Kernel module + obfuscation params + hot peer mgmt via awg syncconf. Snapshot 2026-05-04.
type: reference
originSessionId: 652e2420-3ff6-4298-a3e6-48489cb0137f
---
AmneziaWG = WireGuard fork keeping crypto byte-identical, adding wire-format obfuscation knobs. Snapshot 2026-05-04. **Most complex adapter — read this fully before slice 19.**

## What's added vs vanilla WireGuard

Crypto unchanged: Noise_IK + Curve25519 + ChaCha20-Poly1305 (kernel mode SIMD). What's added at wire-format layer:
- Configurable `uint32` magic header per message type (replaces fixed WG values 1/2/3/4)
- Random padding on init/response/cookie/data messages
- "Junk" UDP packets injected before handshake
- AWG 2.0+: `S3/S4/H3/H4`, ranged headers, `I1-I5` Custom Signature Packets

Removes nothing. Vanilla compat possible by setting all params to 0.

## Obfuscation params — the full list

### Junk packets (`Jc`, `Jmin`, `Jmax`)

| Field | Range | Recommended | Default |
|---|---|---|---|
| `Jc`   | 1 ≤ Jc ≤ 128 | 4–12 | 0 |
| `Jmin` | Jmin < Jmax < 1280 | 8 | 0 |
| `Jmax` | Jmin < Jmax ≤ 1280 | 80 | 0 |

> "The amount of junk packets specified in `Jc` with a random size between `Jmin` and `Jmax` would be generated and sent prior every handshake." — amneziawg-go README

> "Junk packets do not carry any actual data... General recommendation is to use it on the client side only."

⚠️ If `Jmax >= system MTU` (not awg's MTU), packet fragments → suspicious to censor.

### Message paddings (`S1-S4`)

| Field | Description | Range |
|---|---|---|
| `S1` | handshake init padding | ≤ 1132 (= 1280-148); **`S1+56 ≠ S2`** |
| `S2` | handshake response padding | ≤ 1188 (= 1280-92) |
| `S3` | handshake cookie padding (AWG 2.0+) | 15–150 typical |
| `S4` | transport message padding (AWG 2.0+) | 15–150 typical |

The `S1+56 ≠ S2` constraint: if `len(init)+S1+56 == len(resp)+S2`, init and response are size-equal — DPI collapses by length alone.

### Headers (`H1-H4`)

Replace standard WG message-type field. Standard: `1` init, `2` resp, `3` cookie/under-load, `4` data.

| Field | Replaces | Format |
|---|---|---|
| `H1` | type 1 | `x-y` range OR single int. Range 5..2^31-1 |
| `H2` | type 2 | same |
| `H3` | type 3 | same |
| `H4` | type 4 | same |

> "Values could be specified as: range `x-y`, x ≤ y; or single value `1234`"
> "must be unique among each other"

AWG 2.0 default is ranged form (e.g. `H1 = 234567-345678`) — fresh value per session.

### Custom Signature Packets `I1-I5` (AWG 2.0)

Decoy packets sent BEFORE junk packets in order I1→I5. Make connection opening look like other protocols (QUIC/DNS/TLS hello).

Each `I` is a string of tags:

| Tag | Meaning |
|---|---|
| `<b 0x[hex]>` | static bytes (even-length hex) |
| `<r [size]>` | `size` cryptographically random bytes |
| `<rd [size]>` | random ASCII digits |
| `<rc [size]>` | random ASCII letters |
| `<t>` | 4-byte Unix timestamp, network byte order |

QUIC-init mimic example:
```
I1 = <b 0xC0000000010801><r 16><t>
I2 = <b 0x52> <r 1200>
```

⚠️ Older `awg-quick` has `<b 0x...>` parsing bugs (issue #35). Verify `amneziawg-tools` version.

## Sync constraints

- `S*` and `H*` MUST match server↔client (wire format) — mismatch = silent drop
- `Jc/Jmin/Jmax/I1-I5` MAY differ (junk/CPS unidirectional, no real data)
- `H1-H4` ranges must not intersect

## Server setup paths

### Path A: Kernel module (production)
Repo: `amnezia-vpn/amneziawg-linux-kernel-module`. Linux 5.6+ official PPA/COPR for Ubuntu/Debian/Mint/RHEL/SUSE/Fedora.

```bash
# Ubuntu
sudo apt install -y software-properties-common python3-launchpadlib gnupg2 linux-headers-$(uname -r)
sudo add-apt-repository ppa:amnezia/ppa
sudo apt-get install -y amneziawg

# RHEL/Fedora
sudo dnf copr enable amneziavpn/amneziawg
sudo dnf install amneziawg-dkms amneziawg-tools
```

Installs to `/etc/amnezia/amneziawg/` (NOT `/etc/wireguard/`).

### Path B: Userspace Go `amneziawg-go` (fallback)
For containers, BSDs, macOS (`utun`), or DKMS-failure boxes. Build:
```bash
git clone https://github.com/amnezia-vpn/amneziawg-go && cd amneziawg-go && make
amneziawg-go -f wg0          # foreground, debugging
LOG_LEVEL=debug amneziawg-go -f wg0
```

**Don't use Go on production servers** — see Performance below.

### Path C: pre-packaged installers
- `bivlked/amneziawg-installer` — full AWG 2.0, Russian-DPI-targeted, has `mobile` preset for Russian operators, `manage_amneziawg.sh add|remove|list|stats|regen`
- `wiresock/amneziawg-install` — Debian/Ubuntu, `Jc=shuf 3-10, Jmin=50, Jmax=1000`
- `edisglobal awgcfg.py` — Python script-based

**For Ice-Panel: don't depend on these. Mimic config-generation logic in adapter.**

## Config syntax

INI format, identical to WG plus AWG knobs.

### `[Interface]` — AWG-specific keys
- `Jc`, `Jmin`, `Jmax`
- `S1`, `S2`, `S3`, `S4`
- `H1`, `H2`, `H3`, `H4`
- `I1`, `I2`, `I3`, `I4`, `I5`
- All standard WG: `PrivateKey`, `ListenPort`, `FwMark`, plus `awg-quick` extras: `Address`, `DNS`, `MTU`, `Table`, `PreUp`, `PostUp`, `PreDown`, `PostDown`, `SaveConfig`

### `[Peer]` — IDENTICAL to WireGuard
`PublicKey` (req), `PresharedKey`, `AllowedIPs`, `Endpoint`, `PersistentKeepalive`. **No AWG-specific keys here.**

## Tools — `awg`, `awg-quick`

### `awg` subcommands (mirror of `wg`)

| Cmd | Purpose |
|---|---|
| `show` | identical to `wg show` |
| `showconf` | dump config in INI |
| `set` | live mutation, supports `peer KEY remove` |
| `setconf` | replace whole config (drops sessions) |
| `addconf` | append to running |
| **`syncconf`** | **HOT-RELOAD** — diffs+applies only changes, doesn't disrupt active peers |
| `genkey/genpsk/pubkey` | unchanged |

### `awg-quick`
```
awg-quick [up|down|save|strip] [CONFIG_FILE | INTERFACE]
```

- `awg-quick up wg0` — reads `/etc/amnezia/amneziawg/wg0.conf`, runs `ip link add wg0 type amneziawg`, addrs+routes, `awg setconf`, hooks
- `awg-quick strip wg0` — emit config minus `awg-quick`-only directives. **Pipe to `awg syncconf` for hot-reload.**

systemd: `awg-quick@<iface>.service`

## Hot peer management — THE critical capability

**Two patterns:**

### (a) Atomic `awg set` (single peer)
```bash
awg set awg0 peer <PUBKEY> allowed-ips 10.9.9.42/32 persistent-keepalive 25  # add
awg set awg0 peer <PUBKEY> remove                                              # remove
```
Touches only named peer; existing keep handshake state.

### (b) `awg syncconf` (multi-peer reconciliation)
```bash
# Edit /etc/amnezia/amneziawg/awg0.conf, then:
awg syncconf awg0 <(awg-quick strip awg0)
```
> "Like setconf, but reads back existing config first and only makes changes that are explicitly different... benefit of not disrupting current peer sessions."

**Production gotcha (from bivlked):** wrap `syncconf` in **10s timeout**, fall back to `systemctl restart awg-quick@awg0` on hang.

**What CANNOT hot-reload:**
- Changing `[Interface]` AWG params (`Jc`/`H1-H4`/etc.)
- `ListenPort`, `PrivateKey`
- These need full bounce → ALL clients disconnect

**Treat obfuscation params as interface-immutable.** Once committed for an iface, lifetime of the tunnel.

## Recommended params per DPI environment

### Generic safe baseline
```ini
Jc = 4-12 (random per session, e.g. 8)
Jmin = 8
Jmax = 80
S1 = 30 (15-150)
S2 = 80 (15-150, S1+56 != S2)
H1..H4 = unique values in 5..2147483647
```

### Russian TSPU (bivlked default preset)
```ini
Jc = 3..6 (random)
Jmin = 40..89
Jmax = Jmin+50 .. Jmin+250
S1 = ~72 (15..150)
S2 = ~56 (15..150)
S3 = ~32 (8..55)
S4 = ~16 (4..27)
H1 = 234567-345678
H2 = 3456789-4567890
H3 = 56789012-67890123
H4 = 456789012-567890123
I1 = <r 128>
```
Rationale: TSPU does length-fingerprinting; ranged H + S3/S4 + I1 random preamble defeats it.

### Russian mobile (Tele2/Yota/Megafon — bivlked `mobile`)
```ini
Jc = 3 (fixed)
Jmin = 30..50
Jmax = Jmin+20..Jmin+80   # narrower
S1, S2, S3, S4 = same as default
```
"Mobile operators require tighter ranges: narrower Jmax (70 vs 250) reduces packet variance."

### Iran/China GFW
No first-party preset. Use AWG 2.0 with `I1-I5` mimicking QUIC/DNS+aggressive `Jc=10..12`. Verify with packet captures.

## Compatibility

**Question:** AWG server with vanilla WG client?
**Answer:** Only if all knobs zeroed.

> "If there is no value specified, AWG treats it as 0"
> "With all parameters set to zero, behavior defaults to standard WireGuard"

```ini
Jc = 0
S1 = 0
S2 = 0
S3 = 0
S4 = 0
H1 = 1
H2 = 2
H3 = 3
H4 = 4
# I1-I5 unset
```

**For obfuscation to work, BOTH sides must speak AWG with matching `S*`/`H*`.**

**Mixed deployment:** one server, two interfaces — `awg0` (obfuscated) + `wg0` (vanilla) on different ports. Same kernel module hosts both.

## Performance (THE production constraint)

| Implementation | Throughput | Overhead vs vanilla WG |
|---|---|---|
| Vanilla WG kernel | 95 Mbps baseline | — |
| **AWG kernel module** | **92 Mbps** | ~3% |
| AWG userspace `amneziawg-go` | ~33 Mbps | ~65% |

**Kernel module is the only viable production path.** Go userspace bottlenecks on single CPU above 100 Mbps.

## Existing panel integrations — lessons

- **wg-easy v15.2+** — opt-in `EXPERIMENTAL_AWG=true`. Auto-detect kernel, fallback to vanilla. **Insight: panel decides which params are interface-scope (immutable, server-side) vs peer-scope (per-client mutable). `S*`/`H*` interface, `Jc/Jmin/Jmax/I*` per-client.**
- **StealthSurf-VPN/awg-server** — multi-interface pool: each unique CPS-param set gets its own `awgN` interface. Sequential ports. Auto-destroy when last peer removed. **Insight: per-client obfuscation differentiation = interface multiplexing, at cost of port-per-param-set.**
- **bivlked/amneziawg-installer** — single-interface, all clients share params. Simplest production model.

## Recommended Ice-Panel design

1. **Adapter sketch:** `AmneziaWGAdapter` exposes:
   - `createInterface(params) → ifaceId`
   - `addPeer(ifaceId, pubkey, allowedIps)`
   - `removePeer(ifaceId, pubkey)`
   - `syncPeers(ifaceId, peers[])` — `awg syncconf` w/ 10s timeout
   - `getStats()` — parse `awg show <iface> dump`

2. **Param scope (MVP):**
   - `S1-S4`, `H1-H4` — **interface-immutable**
   - `Jc/Jmin/Jmax/I1-I5` — **interface-fixed in MVP** (bivlked-style); upgrade to per-peer in later slice if needed (StealthSurf-style)

3. **Param generator** in panel (TS), not shell. Replicate wiresock's logic:
   - `Jc ∈ [3,10]`
   - `S1/S2 ∈ [15,150]` with `S1+56 ≠ S2` constraint
   - 4 non-overlapping `H` ranges

4. **Hot reload always:**
   ```
   awg syncconf <iface> <(awg-quick strip <iface>)
   ```
   Never `setconf` on live interface unless accepting session loss. **10s timeout fallback.**

5. **Config writer** — generate `.conf` fresh from DB on every change. INI format small, `syncconf` idempotent.

6. **Vanilla WG fallback flag** — operator can emit `[Interface]` without AWG knobs (or `Jc=0, S*=0, H1-4=1,2,3,4`).

7. **Two binaries** wrapped behind same adapter:
   - `awg` (kernel) — default
   - `amneziawg-go` (userspace) — fallback for ARM containers, BSD, DKMS-failure
   - Env detection chooses

8. **Subscription generator** must include all 11+ AWG params verbatim (`S1-S4`, `H1-H4` exactly; `Jc/Jmin/Jmax/I1-I5` may differ per client). Output: `.conf` text + QR PNG + `vpn://` deep-link for Amnezia mobile.

## Logging & debugging

```bash
# Kernel
echo "module amneziawg +p" | sudo tee /sys/kernel/debug/dynamic_debug/control
dmesg -wT

# Userspace Go
LOG_LEVEL=debug amneziawg-go -f wg0
```

Common errors:
- `"Unable to modify interface: Invalid argument"` — bad param (`S1+56 == S2`, overlapping `H` ranges, `I1-I5` syntax in old tools)
- `awg syncconf` hang on stale handshakes — `timeout 10s`, fallback to bounce
- `ip link add ... type amneziawg` fails → `lsmod | grep amneziawg`, `modprobe amneziawg`
- DKMS can't find sources on 5.6+ → `ln -s /path/to/kernel/sources /usr/src/amneziawg-1.0.0/kernel`

## Reference URLs

Authoritative:
- github.com/amnezia-vpn/amneziawg-go (README = canonical type/recommendation table)
- github.com/amnezia-vpn/amneziawg-tools (`awg`, `awg-quick`)
- github.com/amnezia-vpn/amneziawg-linux-kernel-module (README = canonical ranges)
- docs.amnezia.org/documentation/amnezia-wg/

Third-party:
- github.com/bivlked/amneziawg-installer (Russian DPI focused)
- github.com/wiresock/amneziawg-install
- github.com/StealthSurf-VPN/awg-server (multi-interface pattern)
- wg-easy AmneziaWG integration docs
- amneziawg-tools issue #35 (`<b 0x...>` parsing bug history)

## Refresh policy

Re-fetch before slice 19. Critical: AWG 2.0 spec (S3/S4/I1-I5) still maturing — watch for new params, additional installer presets, kernel module upstream merging into mainline (would simplify life massively).
