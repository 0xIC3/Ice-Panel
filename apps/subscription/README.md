# Subscription Generator (vestigial)

> ⚠️ **This directory is empty by design.** The subscription generator was
> never split out as its own service — it lives inside the panel-backend at
> [`apps/panel-backend/src/modules/subscription/`](../panel-backend/src/modules/subscription/).
>
> Kept as a placeholder in case Phase 4 (public release / repo split) needs
> a separate npm package or microservice. Until then this folder is empty.

## Where the code actually lives

```
apps/panel-backend/src/modules/subscription/
├── subscription.routes.ts     GET /sub/:token + ?format= dispatcher
├── subscription.service.ts    Endpoint emission from inbounds table
├── subscription.formats.ts    Discriminated SubscriptionEndpoint union
└── formats/
    ├── clash.ts               Clash Meta YAML
    ├── singbox.ts             Sing-box JSON (1.10+)
    ├── wgconf.ts              wg-quick conf for AmneziaWG
    └── xrayjson.ts            Xray client JSON
```

Per-protocol URI builders for the plain-list format are in a sibling tree:

```
apps/panel-backend/src/core-adapters/{hysteria,xray,amneziawg,naive}/
```
