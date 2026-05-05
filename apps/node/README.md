# Ice-Panel Node Agent

Single static Go binary that runs on each VPS hosting proxy cores.

## Configuration

The agent reads the following environment variables.

### Core (required)

| Var | Default | Description |
|---|---|---|
| `NODE_PAYLOAD` | (required) | Base64url-encoded JSON blob issued by the panel on `POST /api/nodes`. Contains the agent's mTLS cert + key and the panel CA. |
| `NODE_HOST` | `0.0.0.0` | Listen address for the panel-facing mTLS HTTPS server. |
| `NODE_PORT` | `8443` | Listen port for the mTLS HTTPS server. |

### Hysteria adapter

| Var | Default | Description |
|---|---|---|
| `HYSTERIA_BINARY` | (none) | Path to `hysteria` executable. Empty → callback-only mode (no subprocess; Hysteria runs as a separate systemd unit). |
| `HYSTERIA_CONFIG` | (none) | Path to Hysteria YAML config when `HYSTERIA_BINARY` is set. |
| `HYSTERIA_AUTH_HOST` | `127.0.0.1` | Bind host for the local `/auth` callback that Hysteria's `auth.type: http` calls. |
| `HYSTERIA_AUTH_PORT` | `9000` | Bind port for the local `/auth` callback. |

### Xray adapter (opt-in)

The Xray adapter is registered **only** when `XRAY_REALITY_PRIVATE_KEY` is set.
Without REALITY private key the inbound config is invalid; the adapter is
skipped cleanly so single-protocol nodes don't pay for Xray.

| Var | Default | Description |
|---|---|---|
| `XRAY_REALITY_PRIVATE_KEY` | (enables adapter) | x25519 private key. Generate with `xray x25519`. |
| `XRAY_REALITY_SHORT_IDS` | (none, required) | Comma-separated REALITY shortIds (e.g. `abc123,def456`). Adding/removing rebuilds the inbound. |
| `XRAY_REALITY_SERVER_NAMES` | `www.cloudflare.com` | Comma-separated SNI values clients may claim. |
| `XRAY_REALITY_DEST` | `www.cloudflare.com:443` | TLS handshake target the inbound forwards mismatched probes to. |
| `XRAY_PORT` | `443` | TCP port the Xray inbound listens on. |
| `XRAY_BINARY` | (none) | Path to `xray` executable. Empty → config-only mode (writes `config.json` but doesn't spawn xray). |
| `XRAY_CONFIG` | `/etc/xray/config.json` | Path the adapter writes the generated config to. |

## Build

```bash
cd apps/node
go build -o ice-panel-node .
```

## Run

```bash
NODE_PAYLOAD="$(cat payload.b64)" ./ice-panel-node
```

## Endpoints

All endpoints require panel mTLS client cert (`tls.RequireAndVerifyClientCert`).

| Method | Path | Status |
|---|---|---|
| GET  | `/healthz`     | Returns `{ status, cores: [{name, running}] }`. `status: 'degraded'` if any adapter unhealthy. |
| POST | `/addUser`     | Fan-out to all registered adapters. |
| POST | `/removeUser`  | Fan-out to all registered adapters. |
| GET  | `/stats`       | Aggregated counters across adapters. |

Per-adapter behaviour:

- **Hysteria** — `AddUser` updates the in-memory password→user map; client
  reconnects authenticate via the local `/auth` callback. **No subprocess
  restart.**
- **Xray** — `AddUser` rewrites `config.json` and restarts the xray
  subprocess (~1s downtime per mutation). Phase 3 will switch to gRPC
  `proxyman.HandlerService.AlterInbound` for live management.
