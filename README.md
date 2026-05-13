# Ice-Panel

🌍 **English** · [Русский](./README.ru.md)

Self-hosted proxy management panel with **native multi-core architecture**.

Where competitors (Marzban, Remnawave, x-ui) wrap everything through Xray-core, Ice-Panel runs the **real upstream binary** for each protocol — Hysteria 2 server, Xray-core, AmneziaWG kernel module, NaiveProxy (Caddy fork), Shadowsocks 2022, MTProto (`mtg`), Mieru — under a unified `CoreAdapter` abstraction.

## 🚀 One-command install

> Both scripts target Ubuntu 22.04+ / Debian 12+. Require root. Idempotent (safe to re-run). Cycles #6 → #8 reality-checked end-to-end on fresh Aeza fleet (2026-05-12 → 2026-05-13) — full deploy → connect verified for Xray (REALITY+Vision), Hysteria 2, AmneziaWG (iPhone real-traffic, 25 MB through tunnel), and MTProto (Telegram iOS).

### 1. Panel — install on the admin's VPS

**Production with auto-TLS** (recommended) — point a DNS A-record like `panel.example.com` at the VPS (Cloudflare row → **DNS only / gray cloud**), wait for propagation, then:

```bash
sudo -i
PANEL_DOMAIN=panel.example.com \
  bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

The script installs Docker, builds the panel images, brings up Postgres + Redis + backend + frontend, **installs Caddy and configures auto-TLS** for your domain, locks `ufw` to 22/80/443 only, and prints the URL where you bootstrap the first admin. ~5–10 minutes on the first run.

**Bare-IP testing** (HTTP only — for quick local tests):

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-panel.sh)
```

SPA goes up on `http://<vps-ip>:8080`. Don't run anything serious like this — admin JWTs travel in cleartext.

For Cloudflare Proxied mode (yellow cloud) with Origin Certificate — see [docs/deploy/reverse-proxy.md](./docs/deploy/reverse-proxy.md). **Cloudflare proxy is for the panel only** — proxy nodes must use DNS only, since CF Free doesn't pass UDP for Hysteria / AmneziaWG and breaks Xray+REALITY's fingerprint trick.

### 2. Node — one command per protocol

In the panel SPA: **Nodes → Create node** → fill `name` + `address` → submit. The modal reveals a copy-pastable **bootstrap command** with a single-use 15-min token. Paste on the node VPS, append the protocol-specific flags below.

#### Xray (VLESS + REALITY + Vision)

No domain needed — REALITY uses SNI spoofing. First create an Xray inbound in the panel (**Inbounds → Create**, click **Generate** for the keypair), then on the node VPS:

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol xray \
  --xray-reality-private-key sI_p9bg-7cy... \
  --xray-reality-short-ids   abc123 \
  --xray-reality-server-names www.cloudflare.com \
  --xray-reality-dest        www.cloudflare.com:443
```

#### Hysteria 2

Add a DNS A-record `hy2-01.example.com` → VPS IP (DNS only — UDP/443 doesn't go through CF Free anyway). Then:

```bash
sudo -i
bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \
  --panel-url https://panel.example.com \
  --bootstrap bs_xxx \
  --protocol hysteria \
  --hysteria-domain hy2-01.example.com \
  --hysteria-email admin@example.com
```

The script writes `/etc/hysteria/config.yaml` with ACME / masquerade / auth-callback, drops a `hysteria.service` systemd unit, and Hysteria's first run obtains the LE cert via HTTP-01 — no manual SSH editing.

#### AmneziaWG

```bash
bash <(curl -fsSL .../install-node.sh) --panel-url ... --bootstrap ... --protocol amneziawg
```

Installs the upstream amnezia-vpn DKMS kernel module + `awg` / `awg-quick` tools. The installer auto-opens UDP 443 and UDP 1234 in UFW, flips `DEFAULT_FORWARD_POLICY=ACCEPT` (routed-NAT requirement), and configures `ip_forward`.

**Operational notes** (validated live cycle #7/#8):

- **Subnet:** default AWG profile uses `10.66.66.0/24` because `10.0.0.0/24` collides with internal infrastructure gateways on some VPS providers (notably Aeza — server tunnel-IP `10.0.0.1` matches the host's default route, VPS loses connectivity minutes after tunnel up, **no kernel logs**). Pick any non-conflicting `/24` if your provider differs.
- **Port choice:** pick a port **below 9999**. Many RU mobile carriers DPI-drop UDP/443 outbound (Quic-style filter), so the canonical AWG port is throttled at the client side, not server. The panel UI lets the admin set the binding port; recommended `1234`, `51280`, or any high random < 9999. **Don't use 51820** (that's the well-known WireGuard default that DPI targets specifically).
- **Client compatibility:** AmneziaVPN ≥ 4.8.12.9 or Hiddify Next ≥ 2.4. Earlier versions silently fail. AmneziaVPN 4.8.12.9 → 4.8.15.5 also has [upstream bug #2582](https://github.com/amnezia-vpn/amnezia-client/issues/2582) that drops traffic on non-zero S3/S4 — our presets default to `S3=0 S4=0` to dodge it.
- Verified end-to-end on Debian 12 / kernel 6.1.0-47, iPhone iOS 26.4 + AmneziaVPN 4.8.15.4, 25 MB of YouTube traffic through tunnel 2026-05-13.

#### NaiveProxy / Shadowsocks 2022 / MTProto / Mieru

```bash
bash <(curl -fsSL .../install-node.sh) --panel-url ... --bootstrap ... --protocol naive
bash <(curl -fsSL .../install-node.sh) --panel-url ... --bootstrap ... --protocol shadowsocks
bash <(curl -fsSL .../install-node.sh) --panel-url ... --bootstrap ... --protocol mtproto
bash <(curl -fsSL .../install-node.sh) --panel-url ... --bootstrap ... --protocol mieru
```

Bootstrap installs the upstream binary (xcaddy fork for Naive — 2 GB RAM minimum; xray-core for SS2022; `9seconds/mtg` for MTProto; `enfein/mieru` for Mieru).

**Unlike Hysteria**, these protocols take **no** domain / email / cert flags at install time — they all start idle and wait for the panel to push their inbound config via `applyInbounds`. Domain, email, masquerade, and other protocol-specific fields live on the panel-side **Profile** (set once via UI), then auto-propagate to every node the profile is deployed to. Naive needs a real DNS A-record (set in the panel profile's `hostname` field); MTProto picks its masquerade domain in the profile; SS2022 / Mieru have no public-domain requirement.

> ⚠️ **`node.address` is the mTLS endpoint the panel uses to reach the agent** (port `:8443` by default). For routed-style cores (Hysteria / Naive / MTProto) this is the same FQDN that clients will hit on `:443`; for IP-style cores (Xray REALITY / AmneziaWG) it's the bare VPS IP. Set it correctly at node-create time — changing later requires `Refresh bootstrap` (🔑 icon on node row) to re-issue the agent cert with the matching SAN.

Full deploy guide (per-protocol details, troubleshooting, update workflow): **[docs/deploy/install.md](./docs/deploy/install.md)**.

---

## Status

🎯 **Phase 3 = 100%** — all 7 protocol adapters in code; 4 of them verified end-to-end on real client traffic. Panel + nodes deployable via one-command installers, CI green with auto-published container images.

**Verified live on real VPS + real client** (cycle #6 + #7 + #8, through 2026-05-13):
- ✅ **Xray REALITY + Vision** (raw / xhttp / gRPC / Trojan transports) — end-to-end on Aeza Sweden node, Hiddify + Streisand clients
- ✅ **Hysteria 2** + Salamander obfuscation + port-hopping — RU iOS via Hiddify Next on Aeza London, 9 MB+ tunneled cleanly
- ✅ **AmneziaWG** end-to-end on iPhone (AmneziaVPN client 4.8.15.4, Aeza Helsinki) — 25 MB through tunnel, real YouTube traffic. UDP port hop from 443 → 1234 to dodge mobile-carrier DPI; per-user `awg show dump` byte counters reported back to panel UI
- ✅ **MTProto** (`9seconds/mtg` Fake-TLS, masquerade `www.bing.com`) — Telegram iOS client connects via Aeza Sweden node, real messaging traffic
- ✅ Tier-1 security: honeypot trap, honey-user tripwire, per-IP rate-limit, username lockout (5 fails → 15 min lock)
- ✅ Slice 38 self-destruct: node-agent exits 42 on `/healthz` 410-Gone, `RestartPreventExitStatus` blocks systemd from reviving
- ✅ CI: panel typecheck + tests, node-agent Go tests, multi-arch docker images published to `ghcr.io/0xic3/ice-panel-{backend,frontend,node}:main` on every push

**Pipeline-only, real-traffic pending** — code paths exist but client-side verification not yet completed:
- 🟡 NaiveProxy, Shadowsocks 2022, Mieru — never run on a real VPS yet

**Cycle #6 + #7 + #8 reality-check** caught and fixed ~30 live-only bugs that no unit test had reached. Notable cycle #7/#8 additions:
- **AWG default `iptables MASQUERADE` rule had wrong direction** (`-o %i` matched packets going TO peers; correct form is `! -o %i` matching WAN egress). Handshake completed, server received decrypted requests, but responses never routed back because the source IP was un-NATted private 10.x — VPN client showed "Connected" with 25 KiB RX / 348 B TX. Fixed in `apps/node/internal/core/amneziawg/config.go` default PostUp/PostDown.
- **UFW `DEFAULT_FORWARD_POLICY=DROP` silently broke routed VPN.** Forwarded packets through `awg0`→WAN got dropped in FORWARD chain. install-node.sh now flips it to `ACCEPT` in the `amneziawg)` branch.
- **systemd unit's `ProtectSystem=strict` made `/run` read-only for child processes** → ufw + netfilter-persistent both crashed with "Read-only file system: /run/ufw.lock", so `firewall.Allow()` silently no-op'd on fresh nodes. Added `-/run -/etc/iptables` to `ReadWritePaths=`.
- **MTProto FakeTLS secret was 32 bytes instead of 16** (`sha256` digest passed through whole). Telegram client rejected with "Invalid proxy link". Sliced to `[:16]` on both panel (`mtprotoSecret`) and agent (`DeriveSecret`); they stay in sync because both slice identically.
- **AmneziaVPN client bug #2582** — versions 4.8.12.9 through 4.8.15.5 silently drop traffic when server has non-zero S3/S4. All three AWG presets (TSPU / Mobile / Iran) now force `S3=0 S4=0` until upstream ships a fix.
- **AmneziaWG per-user traffic stats wired up** — `GetStats()` was a stub returning zero counters; now parses `awg show <iface> dump`, maps pubkey → userID, reports back to panel "Сегодня" column.
- See `docs/TROUBLESHOOTING.md` for the full numbered list.

Full plan: [docs/ROADMAP.md](./docs/ROADMAP.md) (v3.6, 2026-05-12).
Authoritative protocol-validation status: [docs/PROTOCOL_STATUS.md](./docs/PROTOCOL_STATUS.md).
Per-slice testing checklists: [docs/TESTING.md](./docs/TESTING.md).
Operational debugging knowledge: [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md).

## What's working

### Protocols
| Protocol | What runs on the node | Native or Xray-emulated |
|---|---|---|
| Hysteria 2 | Real `hysteria server` (apernet/hysteria) with auth-callback + Brutal CC + Salamander obfs + port-hopping | native |
| Xray-core | Real `xray run` with VLESS + REALITY + Vision; transports: raw / xhttp / ws / gRPC / httpupgrade / kcp; Trojan subprotocol over REALITY | native |
| AmneziaWG | Real kernel module `amneziawg` (amnezia-vpn DKMS) + `awg-quick` from upstream tools; smart-diff classifier (syncconf vs full restart) | native |
| NaiveProxy | Real Caddy fork (`klzgrad/forwardproxy@naive` via xcaddy) | native |
| Shadowsocks 2022 | xray-core inbound with `2022-blake3-*` ciphers (auto-generated server PSK) | reuses xray binary |
| MTProto | `9seconds/mtg` Fake-TLS, derives per-inbound secret from (id, domain) | native |
| Mieru | `enfein/mieru` (`mita apply config` + reload) | native |

### Subscription generator
- 6 wire formats: `plain` (base64 URI list), `json` (Ice-Panel structured), `clash` (Clash Meta YAML), `singbox` (Sing-box JSON), `wgconf` (wg-quick `.conf`), `xrayjson` (Xray client JSON)
- `?format=` query param explicit choice; otherwise auto-selected by **Subscription Response Rules** (regex on `User-Agent`) — 7 default rules cover Hiddify / Clash / NekoBox / sing-box / v2rayN / AmneziaVPN / `.*` fallback
- Stable per-user IP allocation for AmneziaWG (separate `amneziawg_peers` table)

### Admin UI
- **Users** — CRUD, traffic limits + reset strategies (no_reset / day / week / month / rolling), per-user `enabledProtocols` MultiSelect, soft-delete, HWID device binding (slice S2)
- **Nodes** — CRUD with one-time mTLS payload modal at create, capacity bar, regions for smart-selection, sticky-affinity (slice 27.5)
- **Profiles + Bindings** — slice 27 split: a `Profile` is a logical inbound (protocol + config), `Binding` attaches it to a node with a specific port; many-to-many fan-out
- **Hosts** (slice 30) — per-binding hostname variants for Xray VLESS (multi-FQDN fronting)
- **Squads / Groups** (slice 26) — ACL: which profile is visible to which user-group, default "All" auto-membership
- **SRR** — Subscription Response Rules manager (regex UA → format), 7 default rules cover Hiddify / Clash / NekoBox / sing-box / v2rayN / AmneziaVPN
- **Settings** — brand name, admin-allowed-countries (geo-block), Telegram bot notifications, honey-user tokens
- **Dashboard** — overview cards + 24h traffic chart + recent events
- **Bull-board** at `/admin/queues` for queue introspection

### Operations
- One-command installers for both panel and node — see [docs/deploy/install.md](./docs/deploy/install.md)
- Production `docker-compose.prod.yml` with Postgres + Redis + backend + frontend
- Multi-arch container images auto-published to GHCR on every `main` push (`ghcr.io/0xic3/ice-panel-{backend,frontend,node}:main` + `:sha-<7c>`)
- Tier-1 security gate: honeypot trap (`/.env` / `/wp-admin` / etc) + honey-user subscription tokens (leak tripwire) + per-IP rate-limit + username lockout + admin geo-block via `CF-IPCountry`
- Slice 38 heartbeat self-destruct: node panel-side delete → 410 Gone on heartbeat poll → agent exits 42 → systemd refuses to revive
- Prometheus metrics endpoint + Grafana dashboards (slice 33); Bull-board at `/admin/queues` (slice 37)
- Telegram alerts on admin login / lockout / node flip / honey-user trip / user expired (slice 32)
- 220+ backend integration tests, 80+ Go tests, all green in CI

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Panel (admin's VPS)                                        │
│                                                              │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│   │ panel-backend│   │  panel-      │   │  Postgres +  │    │
│   │  (Fastify TS)│   │  frontend    │   │  Redis       │    │
│   │              │   │  (React/Vite)│   │  (BullMQ)    │    │
│   └──────┬───────┘   └──────────────┘   └──────────────┘    │
└──────────┼──────────────────────────────────────────────────┘
           │ REST over mTLS (panel issues per-node certs)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Node (proxy VPS) — one per protocol recommended            │
│                                                              │
│   ┌──────────────┐                                          │
│   │ node-agent   │  spawn / signal /                        │
│   │ (Go static)  │ ─ syncconf / reload  ──┐                 │
│   └──────┬───────┘                        │                 │
│          │ HTTP auth-callback             ▼                 │
│          │ (Hysteria only)        ┌───────────────┐         │
│          └───────────────────────►│ hysteria  /   │         │
│                                   │ xray      /   │         │
│                                   │ amneziawg /   │         │
│                                   │ caddy-naive   │         │
│                                   └───────────────┘         │
│                                          │                   │
│                                          ▼ proxy traffic    │
│                                       Internet               │
└─────────────────────────────────────────────────────────────┘
```

The transport between panel and node is plain **REST over HTTPS with mutual TLS** — not gRPC. Panel acts as its own CA, issues per-node certificates encoded as a one-time base64 payload, the node-agent decodes it on first start.

### Repository layout

```
apps/
├── panel-backend/        Fastify API (TypeScript) — admin DB, business logic
│   └── src/
│       ├── modules/      one folder per domain (auth, users, nodes,
│       │                  inbounds, subscription, srr, amneziawg, ...)
│       └── core-adapters/  panel-side URI / config builders per protocol
├── panel-frontend/       Admin SPA (React 19 + Mantine 8 + TanStack Query)
└── node/                 Node-agent (Go 1.22+, single static binary)
    └── internal/core/
        ├── hysteria/     auth-callback + subprocess
        ├── xray/         config-restart pattern; gRPC AlterInbound deferred
        ├── amneziawg/    awg syncconf with systemctl restart fallback
        └── naive/        Caddyfile gen + caddy reload

packages/
└── shared/               Wire-format DTOs (TS source-of-truth; Go mirrors)

docs/
├── ROADMAP.md            Slice plan and tech-stack rationale
├── deploy/
│   ├── install.md        One-command install scripts (panel + node)
│   └── hysteria-node.md  Hysteria-specific deploy runbook (slice 13 era)
└── references/           Per-upstream protocol research notes

scripts/
├── install-panel.sh      Docker-based panel installer (one-liner)
└── install-node.sh       systemd-based node installer (one-liner per protocol)
```

## Tech stack

| Layer | Tools |
|---|---|
| Panel API | TypeScript, Fastify 5, Prisma 7, PostgreSQL 16, Zod, Pino |
| Background jobs | Redis 7, BullMQ, `node:events` event bus |
| Auth | JWT (jose), bcrypt, `@fastify/rate-limit` |
| Inter-service | REST + mutual TLS via `@peculiar/x509`, undici client |
| Frontend | React 19, Vite 8, Mantine 8, TanStack Query 5, Zustand 5 |
| Node-agent | Go 1.22+, native `crypto/tls`, `slog`, no gRPC |
| Tests | Vitest (panel), Go testing (node) |
| Infra | Docker, Docker Compose; one-shot install scripts |

## Develop

Requirements: Node 22+, pnpm 10+, Go 1.22+, Docker. Tested on Ubuntu (WSL).

```bash
# 1. Install JS deps
pnpm install

# 2. Start Postgres + Redis (dev compose)
docker compose up -d postgres redis postgres-test

# 3. Apply migrations to dev DB
pnpm --filter @ice-panel/panel-backend exec prisma migrate dev

# 4. Start backend (auto-reloads on save)
pnpm --filter @ice-panel/panel-backend dev

# 5. In a second terminal — start the SPA
pnpm --filter @ice-panel/panel-frontend dev

# 6. Open the SPA
open http://localhost:5173
```

The backend serves on `:3000`, the SPA on `:5173`, and the SPA proxies `/api`+`/sub` to the backend. Bootstrap the first admin via the SPA's "Create first admin" form.

### Tests

```bash
# Panel-backend integration tests (requires postgres-test on :5433)
pnpm --filter @ice-panel/panel-backend test

# Node-agent Go tests (no external services needed)
cd apps/node && go test ./...

# Frontend type-check
pnpm --filter @ice-panel/panel-frontend exec tsc --noEmit
```

## References

Internal protocol research compiled while building Ice-Panel — see [docs/references/](./docs/references/). Hysteria2, AmneziaWG, NaiveProxy, Xray-core operational references plus a deep-dive on Remnawave (architecture / modules / install UX) used as design oracle.

## License

[AGPL-3.0](./LICENSE) — copyleft, network use included. If you run a modified Ice-Panel as a service, you must offer the source to your users.
