# Panel-side Core Adapters

Per-protocol modules that build **client-facing** subscription wire formats
(URIs and config blobs the user pastes into their VPN client). Each
subdirectory mirrors a Go-side `apps/node/internal/core/<protocol>/` adapter
that handles the **server-facing** lifecycle of the same protocol.

## Status

| Folder | Status | Wire format(s) it builds |
|---|---|---|
| [`hysteria/`](./hysteria/) | ✅ shipped (slice 16) | `hysteria2://...` URI |
| [`xray/`](./xray/) | ✅ shipped (slice 17 + 23) | `vless://...` (VLESS+REALITY+Vision); transports raw / xhttp / ws / gRPC |
| [`amneziawg/`](./amneziawg/) | ✅ shipped (slice 19) | wg-quick `[Interface]+[Peer]` text |
| [`naive/`](./naive/) | ✅ shipped (slice 20) | `naive+https://user:pass@host:port?padding=true#name` URI |

Each module exports a `build<Protocol>Uri(...)` (or `buildAmneziawgClientConfig` for
the WG case where there's no URL form).

## How they're orchestrated

The subscription generator at [`../subscription/`](../subscription/) is a thin
fan-out: it iterates the user's enabled inbounds, calls the matching builder,
and the route handler glues output into the requested wire format.

```
inbounds (DB) ─► subscription.service.ts ─► [hysteria, xray, awg, naive] ─► structured endpoints
                                                                            │
                                                                            ├─► encodePlainList ─► base64
                                                                            ├─► clash.ts        ─► YAML
                                                                            ├─► singbox.ts      ─► JSON
                                                                            ├─► wgconf.ts       ─► .conf
                                                                            └─► xrayjson.ts     ─► JSON
```

## Adding a new wire format

1. Decide whether it's URI-style or full-config. URI builders go in
   [`<protocol>/uri.ts`](./xray/uri.ts) (see Xray for the canonical example).
   Config builders go in `<protocol>/<format>.ts` next to it.
2. Update the `SubscriptionEndpoint` discriminated union in
   [`../subscription/subscription.formats.ts`](../subscription/subscription.formats.ts)
   if the new format needs structured fields the existing union doesn't carry.
3. Wire the new builder into [`../subscription/formats/`](../subscription/formats/)
   if it's a *format-level* aggregator (Clash YAML, Sing-box JSON), not a
   per-protocol URI.
4. Add a route case in [`../subscription/subscription.routes.ts`](../subscription/subscription.routes.ts)
   if the new format gets its own `?format=` value.
5. Tests next to the builder; add a route-level test that verifies the right
   `Content-Type` + body shape end-to-end.
