# Ice-Panel

Self-hosted proxy panel with native multi-core support.

## Status

🚧 **Early development** — not ready for production use.

## What makes it different

Most proxy panels (Marzban, Remnawave, x-ui) wrap everything through Xray-core. Ice-Panel uses **native protocol implementations**:

- **Hysteria2** — real Hysteria2 server with Brutal congestion control, salamander obfuscation, port hopping
- **AmneziaWG** — DPI-resistant WireGuard fork
- **NaiveProxy** — HTTP/2 over Chromium network stack
- **Xray-core** — for VLESS/Reality/VMess/Trojan (legacy support)

## Architecture

Monorepo structure:

\`\`\`
Ice-Panel/
├── apps/
│   ├── panel-backend/    # API panel
│   ├── panel-frontend/   # Admin UI
│   ├── node/             # Node agent — orchestrates proxy cores
│   └── subscription/     # Subscription generator (multi-format)
├── packages/
│   ├── proto/            # gRPC schemas (panel ↔ node)
│   ├── shared/           # Shared types & utilities
│   └── core-adapters/    # Adapter for each proxy core
└── docker/               # Dockerfiles
\`\`\`

## Tech Stack

- **Backend:** TypeScript, Fastify, Prisma, PostgreSQL
- **Frontend:** React, TanStack Query, Mantine
- **Node agent:** Go (orchestrates native binaries)
- **Protocol:** gRPC between panel and nodes

## License

[AGPL-3.0](./LICENSE)
