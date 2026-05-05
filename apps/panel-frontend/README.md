# Ice-Panel Admin Frontend

React 19 + Vite SPA for the Ice-Panel admin UI.

## Stack

- **React 19** + **TypeScript**
- **Vite 8** — dev server + build
- **Mantine 8** — UI kit (AppShell, Table, Form, Modal, Notifications)
- **TanStack Query 5** — server-state (lists, mutations, cache)
- **Zustand 5** — client-state (auth token, UI state)
- **React Router DOM 7** — routing + protected routes
- **Axios** — HTTP client; types from `@ice-panel/shared`

## Develop

The backend must be running at `http://localhost:3000` (`pnpm --filter @ice-panel/panel-backend dev` from the repo root).

```bash
pnpm --filter @ice-panel/panel-frontend dev
# → http://localhost:5173
```
