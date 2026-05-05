# @ice-panel/shared

Source-of-truth wire-format types for the **panel ↔ node REST API**.

This is a workspace-only TypeScript package — no build step, just `.ts`
exported via `"main": "./src/index.ts"`. The panel-backend imports these
types directly; the Go node-agent re-implements matching structs with
`json:` tags in [`apps/node/internal/dto/`](../../apps/node/internal/dto/).

## What's in here

`src/transport.ts` — every payload that travels over the panel→node mTLS
HTTPS API:

- `ProtocolName` — `'hysteria' | 'xray' | 'amneziawg' | 'naive'`
- `ProtocolCredentials` — per-protocol creds attached to a user
- `AddUserRequest` / `AddUserResponse`
- `RemoveUserRequest` / `RemoveUserResponse`
- `GetStatsResponse` — aggregated user counters
- `HealthcheckResponse` — `/healthz` shape with per-core status
- `NodeErrorResponse` — common error shape

## Adding a field

Workflow when extending the wire format:

1. Edit [`packages/shared/src/transport.ts`](./src/transport.ts) — add
   the field, document its semantics in a comment.
2. Mirror it in [`apps/node/internal/dto/dto.go`](../../apps/node/internal/dto/dto.go)
   with the matching `json:` tag (camelCase preserved).
3. If it's a credential, also extend [`apps/node/internal/core/types.go`](../../apps/node/internal/core/types.go)'s
   `core.User` struct, then wire it into the dispatcher in
   [`apps/node/internal/server/server.go`](../../apps/node/internal/server/server.go).
4. Update both panel-backend and node-agent simultaneously — there's no
   versioning machinery yet, mismatches surface as `INVALID_BODY` 400s.

A concrete example: slice 19 added `amneziawgAllowedIp` to
`ProtocolCredentials` so panel could push the IP-allocator's choice to the
node-agent. That single field touched all four files above.
