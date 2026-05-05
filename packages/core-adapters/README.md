# Core Adapters (vestigial)

> ⚠️ **This directory is empty by design.** Core adapters live in two places
> in the actual codebase, neither is here:
>
> - **Node-side** (Go, runs on each VPS):
>   [`apps/node/internal/core/`](../../apps/node/internal/core/) — manages the
>   actual proxy binary subprocess (Hysteria / Xray / AmneziaWG / Naive)
> - **Panel-side** (TypeScript, runs in the panel-backend):
>   [`apps/panel-backend/src/core-adapters/`](../../apps/panel-backend/src/core-adapters/) —
>   builds client-facing URIs / configs for subscription
>
> Kept as a placeholder in case Phase 4 (public release / repo split)
> publishes panel-side adapters as a standalone npm package. Until then this
> folder is empty.

## Per-protocol layout

| Protocol | Node-side | Panel-side |
|---|---|---|
| Hysteria2 | [`apps/node/internal/core/hysteria/`](../../apps/node/internal/core/hysteria/) | [`apps/panel-backend/src/core-adapters/hysteria/`](../../apps/panel-backend/src/core-adapters/hysteria/) |
| Xray | [`apps/node/internal/core/xray/`](../../apps/node/internal/core/xray/) | [`apps/panel-backend/src/core-adapters/xray/`](../../apps/panel-backend/src/core-adapters/xray/) |
| AmneziaWG | [`apps/node/internal/core/amneziawg/`](../../apps/node/internal/core/amneziawg/) | [`apps/panel-backend/src/core-adapters/amneziawg/`](../../apps/panel-backend/src/core-adapters/amneziawg/) |
| NaiveProxy | [`apps/node/internal/core/naive/`](../../apps/node/internal/core/naive/) | [`apps/panel-backend/src/core-adapters/naive/`](../../apps/panel-backend/src/core-adapters/naive/) |

The contract that ties them together is [`apps/node/internal/core/adapter.go`](../../apps/node/internal/core/adapter.go) — the `CoreAdapter` Go interface every node-side adapter implements.
