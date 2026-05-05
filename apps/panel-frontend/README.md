# Ice-Panel Admin Frontend

React 19 + Vite 8 SPA for the Ice-Panel admin UI.

## Stack

- **React 19** + **TypeScript**
- **Vite 8** — dev server + build, single-page app served by nginx in prod
- **Mantine 8** — UI kit (AppShell, Table, Form, Modal, Notifications, MultiSelect, SegmentedControl)
- **TanStack Query 5** — server state with cache invalidation on mutation
- **Zustand 5** + persist middleware — auth token kept in localStorage
- **React Router DOM 7** — routes + ProtectedRoute gate
- **Axios** — HTTP client with JWT interceptor + 401-clear-session interceptor

## Pages

| Route | Page | Notes |
|---|---|---|
| `/login` | LoginPage | Renders "Create first admin" if no admin exists yet |
| `/users` | UsersPage | CRUD, traffic limits + reset strategies, `enabledProtocols` MultiSelect, soft-delete confirm modal |
| `/nodes` | NodesPage | CRUD + one-time mTLS payload modal at create (must be saved by admin — panel never re-emits) |
| `/inbounds` | InboundsPage | Per-protocol form (Hysteria / Xray / AmneziaWG / Naive) — Xray network selector (raw/xhttp/ws/grpc) + Generate-keypair button |
| `/srr` | SrrPage | Subscription Response Rules CRUD + Test-against-UA panel |

## Develop

The backend must be running at `http://localhost:3000` (`pnpm --filter @ice-panel/panel-backend dev` from the repo root).

```bash
pnpm --filter @ice-panel/panel-frontend dev
# → http://localhost:5173
```

Vite proxies `/api` and `/sub` to the backend, so the SPA is same-origin in dev.

## Type-check

```bash
pnpm --filter @ice-panel/panel-frontend exec tsc --noEmit
```

The IDE TS-server occasionally lags on `/mnt/c` paths and shows phantom
"Cannot find module" diagnostics — trust the CLI `tsc` over IDE squiggles.

## Production build

```bash
pnpm --filter @ice-panel/panel-frontend build
# emits dist/ which the nginx Dockerfile picks up
```

`Dockerfile` builds Vite then serves via `nginx:alpine` with reverse-proxy
config that forwards `/api`, `/sub`, `/health` to the backend service in
`docker-compose.prod.yml`. Single-origin in prod = no CORS hassles.
