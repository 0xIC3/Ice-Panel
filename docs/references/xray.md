---
name: Xray-core reference for Slice 17 XrayAdapter
description: Full reference for managing Xray-core via gRPC API + config.json. REALITY, Vision, uTLS, transports, stats. Snapshot 2026-05-04.
type: reference
originSessionId: 652e2420-3ff6-4298-a3e6-48489cb0137f
---
Xray-core operational reference. Snapshot 2026-05-04 from xtls.github.io. **Critical naming change v24.9.30:** `tcp` → `raw`, `splithttp` → `xhttp`, `httpSettings` (h2) removed. Old strings still parse as aliases for backward compat.

## Top-level config sections

| Section | Purpose |
|---|---|
| `log` | logging |
| `api` | gRPC API for runtime control |
| `dns` | built-in DNS |
| `routing` | rule-based traffic steering |
| `policy` | level-based limits + stats opt-in |
| `inbounds[]` | listeners |
| `outbounds[]` | upstream paths |
| `transport` | transport defaults |
| `stats` | enable counters (`{}` to enable) |
| `reverse` | reverse proxy |
| `fakedns` | FakeDNS for transparent proxies |

## Inbound shape

```jsonc
{
  "listen": "127.0.0.1",      // or "/dev/shm/x.sock"
  "port": 443,                // number | "5-10" | "env:PORT"
  "protocol": "vless",        // vless|vmess|trojan|shadowsocks|socks|http|wireguard|hysteria|dokodemo-door|tunnel
  "settings": { /* protocol-specific */ },
  "streamSettings": { /* below */ },
  "tag": "in-vless-reality",  // unique
  "sniffing": { /* below */ }
}
```

## VLESS inbound (flagship)

```jsonc
{
  "clients": [
    {
      "id": "5783a3e7-e373-51cd-8642-c83782b807c5",
      "level": 0,
      "email": "love@xray.com",                  // REQUIRED for stats
      "flow": "xtls-rprx-vision"                 // or "" or "xtls-rprx-vision-udp443"
    }
  ],
  "decryption": "none",                          // REQUIRED, must be "none"
  "fallbacks": [ /* FallbackObject[] */ ]
}
```

- `decryption` mandatory — leaving empty rejects; use `"none"` to disable
- `email` must be unique; stats keyed by it
- Fallbacks AFTER TLS decryption (see Fallbacks section)

## VMess inbound

```jsonc
{
  "clients": [
    { "id": "<uuid>", "level": 0, "email": "u@panel" }
  ]
}
```
Modern Xray runs AEAD mode; legacy `alterId`/`security` removed.

## Trojan inbound

```jsonc
{
  "clients": [
    { "password": "pw", "email": "u@panel", "level": 0 }
  ],
  "fallbacks": [{ "dest": 80 }]
}
```
Must run over TLS. Fallback when "first packet length < 58, OR byte 57 is not `\r`, OR auth fails."

## Shadowsocks inbound

```jsonc
{
  "network": "tcp,udp",
  "method": "2022-blake3-aes-128-gcm",         // 2022 recommended
  "password": "<base64>",                      // openssl rand -base64 16/32
  "clients": [{ "password": "...", "method": "..." }]
}
```

Methods:
- **2022 (recommended):** `2022-blake3-aes-128-gcm` (16B), `2022-blake3-aes-256-gcm` (32B), `2022-blake3-chacha20-poly1305` (32B)
- **Legacy AEAD:** `aes-128-gcm`, `aes-256-gcm`, `chacha20-poly1305`, `xchacha20-poly1305`
- **Plaintext:** `none`, `plain`

## Stream settings (transport)

```jsonc
{
  "network": "raw",                  // raw|xhttp|kcp|grpc|ws|httpupgrade|hysteria
  "security": "reality",             // none|tls|reality
  "tlsSettings": { /* ... */ },
  "realitySettings": { /* ... */ },
  "rawSettings": { /* was tcpSettings */ },
  "xhttpSettings": { /* was splithttpSettings */ },
  "kcpSettings": { /* ... */ },
  "grpcSettings": { /* ... */ },
  "wsSettings": { /* ... */ },
  "httpupgradeSettings": { /* ... */ },
  "sockopt": { /* ... */ }
}
```

### WebSocket
```jsonc
{
  "path": "/",                                 // /mypath?ed=2560 enables Early Data
  "host": "xray.com",
  "headers": { "key": "value" },
  "heartbeatPeriod": 10                        // sec; 0 disables Pings
}
```
Early Data: `ed` recommended 2560, max 8192. Host priority: `host` > `headers` > `address`.

### gRPC
```jsonc
{
  "serviceName": "name",                       // or "/path1|path2"
  "multiMode": false,                          // experimental, ~20% gain
  "idle_timeout": 60,                          // min 10
  "health_check_timeout": 20,
  "permit_without_stream": false,
  "initial_windows_size": 0
}
```

### XHTTP (replaces SplitHTTP)
```jsonc
{
  "host": "example.com",
  "path": "/yourpath",
  "mode": "auto",                              // auto|packet-up|stream-up|stream-one
  "extra": {
    "headers": {},
    "xPaddingBytes": "100-1000",
    "noGRPCHeader": false,
    "noSSEHeader": false,
    "scMaxEachPostBytes": 1000000,
    "scMinPostsIntervalMs": 30,
    "scMaxBufferedPosts": 30,
    "scStreamUpServerSecs": "20-80",
    "xmux": {
      "maxConcurrency": "16-32",
      "maxConnections": 0,
      "cMaxReuseTimes": 0,
      "hMaxRequestTimes": "600-900",
      "hMaxReusableSecs": "1800-3000",
      "hKeepAlivePeriod": 0
    },
    "downloadSettings": { "address": "...", "port": 443, "network": "xhttp", "security": "tls", ... }
  }
}
```

XHTTP modes:
- `auto` — TLS H2 → `stream-up`; REALITY → `stream-one`; otherwise `packet-up`
- `packet-up` — packets up, stream down. Most CDN-compat
- `stream-up` — bidirectional, requires gRPC on CDN
- `stream-one` — single POST bidirectional (REALITY default)

## TLS settings

```jsonc
{
  "serverName": "example.com",
  "alpn": ["h2", "http/1.1"],
  "allowInsecure": false,                       // client; deprecated — prefer pinnedPeerCertSha256
  "minVersion": "1.2",
  "maxVersion": "1.3",
  "rejectUnknownSni": false,                    // server side
  "fingerprint": "chrome",                      // uTLS — see below
  "pinnedPeerCertSha256": "e8e2d387fd...",     // hex SHA256
  "masterKeyLog": "",                           // for Wireshark
  "certificates": [
    {
      "certificateFile": "/path/cert.crt",
      "keyFile": "/path/key.key",
      "usage": "encipherment"                   // encipherment|verify|issue
    }
  ]
}
```

OCSP stapling auto when `certificateFile`+`keyFile` used.

## REALITY ⭐

**Server (inbound):**
```jsonc
{
  "show": false,                              // debug
  "target": "www.microsoft.com:443",          // a.k.a. "dest"
  "xver": 0,                                  // 0|1|2 PROXY protocol
  "serverNames": ["www.microsoft.com"],
  "privateKey": "<from `xray x25519`>",
  "minClientVer": "",
  "maxClientVer": "",
  "maxTimeDiff": 0,                           // ms tolerance
  "shortIds": ["", "0123456789abcdef"]        // ≤ 16 hex chars
}
```

**Client (outbound):**
```jsonc
{
  "show": false,
  "fingerprint": "chrome",                    // uTLS
  "serverName": "www.microsoft.com",          // must match one of server's serverNames
  "publicKey": "<from `xray x25519 -i privKey`>",
  "shortId": "0123456789abcdef",
  "spiderX": ""
}
```

**How it works:**
1. Server configured with public TLS site as `target` (e.g. `www.microsoft.com:443`)
2. Client sends real TLS ClientHello with SNI=`serverName` + stenographic auth token in extensions, signed via server's X25519 pubkey
3. Xray proxies bytes upstream to `target`. If auth validates → hijacks session, decrypts as VLESS. If not → transparently relays to `target` — DPI/prober sees real cert chain from real Microsoft
4. Client's `fingerprint` (uTLS) makes ClientHello byte-identical to real browser

**Recommended `target` criteria:**
- TLS 1.3, X25519 (or `X25519MLKEM768` PQ), H2 (ALPN `h2`)
- High-reputation, won't get blocked
- `xray tls ping <host>` to validate

Common picks: `www.microsoft.com`, `www.cloudflare.com`, `www.amazon.com`, `www.tesla.com`, `www.lovelive-anime.jp`, `www.swift.com`, `www.bing.com`, `gateway.icloud.com`. Rotate every 2-3 months.

**CLI helpers:**
- `xray x25519` — outputs `Private key:` + `Public key:`
- `xray uuid` — UUIDs for client IDs
- `xray tls ping <host>` — validate target candidacy

## uTLS fingerprints

Valid `fingerprint` values:

| Auto-mapped to latest | Auto-generated | Native |
|---|---|---|
| `chrome` | `random` (newer browsers) | e.g. `HelloChrome_106_Shuffle` |
| `firefox` | `randomized` (synthesized) | `HelloRandomizedNoALPN` |
| `safari` |   | `HelloChrome_120_PQ` |
| `ios` |   | `HelloEdge_106` |
| `android` |   | `HelloFirefox_105` |
| `edge` |   | `HelloSafari_16_0` |
| `360`, `qq` |   | (full list in refraction-networking/utls) |

Strings `"unsafe"`, `"hellogolang"` rejected.

> "This feature only **simulates** the TLS Client Hello fingerprint. Behavior and other fingerprints are the same as Golang."

## XTLS Vision

`flow` values on VLESS:

| Value | Behavior |
|---|---|
| `""` | Standard TLS, full re-encryption (TLS-in-TLS visible) |
| `xtls-rprx-vision` | Inner-handshake-random-padding XTLS. After inner TLS handshake, payload "spliced" — sent without outer wrapper. Eliminates TLS-in-TLS pattern. Intercepts UDP→443 (QUIC) to force HTTPS |
| `xtls-rprx-vision-udp443` | Same but does NOT intercept UDP/443 — use when app needs QUIC |

**Required on BOTH client and server.** ONLY over `network: raw` + `security: tls`/`reality`. **Not over WS/gRPC/H2/XHTTP.**

**Best combo:** REALITY + xtls-rprx-vision + uTLS = (no server cert fingerprint) + (no TLS-in-TLS pattern) + (no client TLS fingerprint).

## Multiplexing (mux) and XUDP

```jsonc
"mux": {
  "enabled": true,
  "concurrency": 8,                           // -1 disable; 1-1024
  "xudpConcurrency": 16,                      // separate mux for UDP
  "xudpProxyUDP443": "reject"                 // reject|skip|allow
}
```

- "Only needs to be enabled on client side; server adapts automatically"
- "Designed to reduce TCP handshake latency rather than boost throughput, making it unsuitable for bandwidth-intensive tasks like video streaming"
- **XUDP** = UDP-over-TCP tunnel — wraps UDP in mux substream
- **For VLESS+Vision: do NOT enable mux on client** — conflicts with splice. Enable only when not using `xtls-rprx-vision`.

## Outbounds

### freedom
```jsonc
{
  "domainStrategy": "AsIs",                   // AsIs|UseIP|UseIPv4|UseIPv6|... |ForceIP|...
  "redirect": "127.0.0.1:3366",
  "fragment": {
    "packets": "tlshello",                    // "1-3" | "tlshello"
    "length": "100-200",
    "interval": "10-20"
  },
  "noises": [{ "type": "base64", "packet": "...", "delay": "10-16" }]
}
```

### blackhole
```jsonc
{ "response": { "type": "http" } }            // none|http (HTTP 403 + close)
```

### dns
```jsonc
{
  "network": "udp",                           // tcp|udp
  "address": "1.1.1.1",
  "port": 53,
  "rules": [{ "action": "reject", "domain": ["domain:example.com"] }]
}
```
DNS rule actions: `direct`, `hijack`, `drop`, `reject`.

## Routing

```jsonc
"routing": {
  "domainStrategy": "AsIs",                  // AsIs|IPIfNonMatch|IPOnDemand
  "domainMatcher": "hybrid",                 // linear|hybrid (faster)
  "rules": [
    {
      "type": "field",
      "domain": ["domain:youtube.com", "geosite:google", "regexp:\\.cn$", "full:foo.com", "keyword:ads"],
      "ip": ["10.0.0.0/8", "geoip:cn", "geoip:private"],
      "port": "53,443,1000-2000",
      "sourcePort": "53",
      "network": "tcp",
      "source": ["10.0.0.1"],
      "user": ["love@xray.com"],
      "inboundTag": ["in-vless"],
      "protocol": ["http", "tls", "bittorrent"],
      "outboundTag": "direct",
      "balancerTag": "balancer-a"
    }
  ],
  "balancers": [
    {
      "tag": "balancer-a",
      "selector": ["out1", "out2"],
      "strategy": { "type": "leastPing" },   // random|roundRobin|leastPing|leastLoad
      "fallbackTag": "direct"
    }
  ]
}
```

Domain prefixes:
- `domain:foo.com` — `foo.com` and subdomains
- `full:foo.com` — exact
- `keyword:foo` — substring (default if no prefix)
- `regexp:^.*\.cn$` — Go regexp
- `geosite:google` — bundled list
- `ext:filename:tag` — custom file

IP: CIDR (`10.0.0.0/8`), `geoip:cn`, `geoip:private`, `ext:`.

Rules eval top-to-bottom; first match wins. Multiple criteria within one rule = AND.

## API service ⭐ (for runtime user mgmt)

```jsonc
"api": {
  "tag": "api",
  "listen": "127.0.0.1:8080",
  "services": [
    "HandlerService",     // Add/Remove inbounds, Add/Remove users
    "LoggerService",      // restart logger (logrotate)
    "StatsService",       // GetStats / QueryStats / GetSysStats
    "RoutingService",     // modify rules
    "ReflectionService"
  ]
}
```

**Auth:** Xray has NO built-in mTLS/token auth on API. Standard practice: **bind to 127.0.0.1** + OS isolation, OR Unix socket only panel can access.

**Key gRPC methods for panel** (proto: `app/proxyman/command`, `app/stats/command`):
- `HandlerService.AddInbound(InboundConfig)` / `RemoveInbound(tag)`
- `HandlerService.AddOutbound` / `RemoveOutbound`
- `HandlerService.AlterInbound(AddUserOperation{user})` — add user to existing inbound
- `HandlerService.AlterInbound(RemoveUserOperation{email})` — remove by email
- `StatsService.GetStats(name, reset)` — single counter
- `StatsService.QueryStats(pattern, reset)` — wildcard
- `StatsService.GetSysStats()` — process-wide
- `LoggerService.RestartLogger()` — for logrotate

**For our XrayAdapter:** boot Xray with minimal `config.json` (logging, api, policy, stats, routing skeleton, NO users), then `AddInbound` + `AlterInbound(AddUserOperation)` over gRPC for everything panel-managed. **No reload needed, no dropped connections.**

## Fallbacks (VLESS/Trojan)

After TLS termination, Xray inspects first plaintext bytes. If not valid VLESS/Trojan, forwards to `fallbacks[]`:

```jsonc
"fallbacks": [
  { "alpn":"h2",       "path":"",      "dest":"127.0.0.1:8001", "xver":1 },
  { "alpn":"http/1.1", "path":"/ws",   "dest":"127.0.0.1:8002" },
  { "alpn":"http/1.1", "path":"/grpc", "dest":"@unix.sock" },
  {                                    "dest": 80 }              // default
]
```

Match precedence: most-specific wins. `alpn`/`path` empty = wildcard. `xver` (1|2) = PROXY protocol. `dest`: `addr:port` | `port` (= `127.0.0.1:port`) | `@unixsocket` | `@@abstract`.

## Stats & Policy ⭐

Stats counters require **BOTH** `stats: {}` AND `policy` flags.

```jsonc
"stats": {},
"policy": {
  "levels": {
    "0": {
      "handshake": 4,
      "connIdle": 300,
      "uplinkOnly": 2,
      "downlinkOnly": 5,
      "statsUserUplink": true,
      "statsUserDownlink": true,
      "statsUserOnline": true,
      "bufferSize": 4
    }
  },
  "system": {
    "statsInboundUplink": true,
    "statsInboundDownlink": true,
    "statsOutboundUplink": true,
    "statsOutboundDownlink": true
  }
}
```

**Counter names:**
- `user>>>love@xray.com>>>traffic>>>uplink`
- `user>>>love@xray.com>>>traffic>>>downlink`
- `user>>>love@xray.com>>>online`
- `inbound>>>in-vless>>>traffic>>>uplink|downlink`
- `outbound>>>direct>>>traffic>>>uplink|downlink`

**Per-user stats need:** `email` set on user AND `statsUserUplink`/`Downlink: true` at user's level. Default level 0 has these FALSE — bootstrap policy must set them.

## Logging

```jsonc
"log": {
  "access": "/var/log/xray/access.log",      // ""=stdout | "none"=disable
  "error": "/var/log/xray/error.log",
  "loglevel": "warning",                     // debug|info|warning|error|none
  "dnsLog": false,
  "maskAddress": "quarter"                   // quarter|half|full
}
```

Rotation: `SIGUSR1` to xray, OR `LoggerService.RestartLogger()` over gRPC.

## Sniffing

```jsonc
"sniffing": {
  "enabled": true,
  "destOverride": ["http", "tls", "quic", "fakedns"],
  "metadataOnly": false,
  "routeOnly": false,                        // route by sniffed domain but dial original IP
  "domainsExcluded": [],
  "ipsExcluded": []
}
```

## Reference: VLESS+REALITY+Vision (flagship config)

```jsonc
{
  "log": { "loglevel": "warning" },
  "stats": {},
  "api": {
    "tag": "api",
    "listen": "127.0.0.1:10085",
    "services": ["HandlerService","StatsService","LoggerService"]
  },
  "policy": {
    "levels": { "0": { "statsUserUplink": true, "statsUserDownlink": true, "statsUserOnline": true } },
    "system": { "statsInboundUplink": true, "statsInboundDownlink": true,
                "statsOutboundUplink":true, "statsOutboundDownlink":true }
  },
  "inbounds": [{
    "listen": "0.0.0.0",
    "port": 443,
    "protocol": "vless",
    "tag": "in-vless-reality",
    "settings": {
      "clients": [{ "id": "<uuid>", "flow": "xtls-rprx-vision", "email": "u@panel" }],
      "decryption": "none"
    },
    "streamSettings": {
      "network": "raw",
      "security": "reality",
      "realitySettings": {
        "show": false,
        "target": "www.microsoft.com:443",
        "xver": 0,
        "serverNames": ["www.microsoft.com"],
        "privateKey": "<x25519 priv>",
        "shortIds": ["", "0123456789abcdef"]
      }
    },
    "sniffing": { "enabled": true, "destOverride": ["http","tls","quic"], "routeOnly": true }
  }],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "block" }
  ],
  "routing": {
    "domainStrategy": "AsIs",
    "rules": [{ "type":"field", "ip":["geoip:private"], "outboundTag":"block" }]
  }
}
```

## Practical notes for XrayAdapter (Slice 17)

1. **Config file vs API:** boot from `config.json` (minimal: log, api, policy, stats, routing, NO users). Runtime user/inbound changes via gRPC API — **no reload, no dropped connections.**
2. **Idempotency:** `AddUserOperation` errors if email exists. Wrap with "remove then add" or precheck via stats counter.
3. **Stats reset:** `GetStats(name, reset=true)` for accumulating period traffic; `false` to peek without reset.
4. **Process supervision:** Xray exits on bad config. Deploy with systemd `Restart=on-failure` + `RestartSec=3`.
5. **Generation helpers (CLI):** `xray uuid`, `xray x25519`, `xray wg` (wireguard keys), `xray tls ping <host>`.
6. **Vision rule:** Vision incompatible with `mux`, only valid over `network: raw`. **Validate at config-build time in adapter.**
7. **shortIds:** REALITY shortIds are inbound-level — adding/removing requires `AddInbound`/`RemoveInbound` rebuild (NOT `AlterInbound`).
8. **Per-user stats need `email` SET on client + level policy `statsUserUplink/Downlink: true`.** Default level 0 has these false.
9. **email uniqueness** required. Use our `users.email` if set, else `users.username@panel`.
10. **For our gRPC client:** use `@remnawave/xtls-sdk` library — already wraps these methods, saves us writing protobuf bindings. Or roll our own with `@grpc/grpc-js` + xray-core protos.

## Sources

- xtls.github.io/en/config/ (Configuration overview, Inbound, Outbound, Transport, all transports)
- xtls.github.io/en/config/inbounds/{vless,vmess,trojan,shadowsocks,socks,http,tunnel}.html
- xtls.github.io/en/config/transports/{raw,mkcp,websocket,grpc,httpupgrade}.html
- xtls.github.io/en/config/{routing,dns,api,stats,policy,log}.html
- xtls.github.io/en/config/features/{fallback,browser_dialer}.html
- xtls.github.io/en/config/outbounds/{freedom,blackhole,dns,vless}.html
- github.com/XTLS/Xray-core/discussions/4113 (XHTTP spec)
- github.com/XTLS/Xray-examples (sample configs, especially REALITY+Vision)
- DeepWiki: Flow Control and Vision

## Refresh policy

Re-fetch before slice 17. Xray evolves fast (minor breaking changes between major versions). Watch for:
- New transport types (XHTTP getting more modes)
- REALITY 2.0 if/when published
- New uTLS fingerprints
- API/proto changes
