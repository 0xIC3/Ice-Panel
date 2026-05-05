# Panel-side Core Adapters

Per-protocol modules that build subscription wire-formats for clients.
Each subdirectory mirrors a Go-side `internal/core/<protocol>/` adapter.

| Folder | Status | Wire formats it builds |
|---|---|---|
| `hysteria/` | ✅ slice 16 | `hysteria2://` URI |
| `xray/` | ⏭️ slice 17 | `vless://` (REALITY/Vision), `vmess://`, `trojan://` |
| `amneziawg/` | ⏭️ slice 19 | `wg-quick` `.conf` |
| `naive/` | ⏭️ slice 20 | `naive+https://` URI |

Each module exports a `build<Protocol>Uri(...)` function (and, in slice 21,
sibling helpers for Clash YAML / Sing-box JSON / etc).

The subscription generator (`modules/subscription/`) is a thin orchestrator:
it iterates the user's `enabledProtocols`, calls the matching adapter, and
glues outputs together per requested format.
