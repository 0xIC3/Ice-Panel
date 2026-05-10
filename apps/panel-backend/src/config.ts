import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Public Hysteria UDP port advertised in subscription URIs. Different from
  // the panel↔node control-plane port stored in `nodes.address`. Slice 23
  // (inbounds CRUD) will replace this with per-inbound config.
  HYSTERIA_PUBLIC_PORT: z.coerce.number().int().min(1).max(65535).default(443),

  // Public Xray VLESS+REALITY port advertised in subscription URIs.
  XRAY_PUBLIC_PORT: z.coerce.number().int().min(1).max(65535).default(443),

  // REALITY parameters mirror what's set on every node-agent's xray inbound.
  // All three must be present for the panel to emit `vless://` endpoints; any
  // missing → user's enabledProtocols=['xray'] yields no endpoints. Slice 23
  // moves these into the inbounds table per node.
  XRAY_REALITY_PUBLIC_KEY: z.string().optional(),
  XRAY_REALITY_SHORT_ID: z.string().regex(/^[0-9a-fA-F]{0,16}$/, 'hex up to 16 chars').optional(),
  XRAY_REALITY_SNI: z.string().optional(),
  XRAY_FLOW: z.string().default('xtls-rprx-vision'),
  XRAY_FINGERPRINT: z.string().default('chrome'),

  // Comma-separated list of frontend origins allowed to call the API.
  // Default covers the Vite dev server.
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // Public-facing base URL of this panel (e.g. https://panel.example.com).
  // REQUIRED — used to generate bootstrap install commands, subscription
  // links, AND the panelUrl baked into node payloads (slice 38 heartbeat).
  // Letting it be optional silently broke heartbeat self-destruct because
  // agents shipped with `panelUrl=undefined` and never polled — the
  // mechanism that was supposed to revoke a stolen bundle just sat dead.
  PUBLIC_URL: z.url(),

  // Number of trusted reverse-proxy hops in front of the backend. Zero
  // (default) → request.ip is the immediate socket peer; X-Forwarded-For
  // is ignored. Production behind Caddy + Cloudflare uses 2. Don't bump
  // this above the actual hop count or any client can spoof X-Forwarded-
  // For and bypass per-IP rate limits.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),

  // Per-route rate-limit knobs, tunable per deployment. Defaults are
  // tuned for a small panel; raise on busy multi-thousand-user instances.
  RATE_LIMIT_SUB_PER_MIN: z.coerce.number().int().min(1).default(30),
  RATE_LIMIT_BOOTSTRAP_PER_MIN: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_HEARTBEAT_PER_MIN: z.coerce.number().int().min(1).default(120),

  // Slice S7 — public IP of the panel, baked into the node-install
  // command as `--panel-ip`. Causes the agent's UFW to allow :8443/tcp
  // ONLY from this IP. CRITICAL: must be the panel's *origin* IP, not
  // a Cloudflare edge IP. Optional — without it the install command
  // shows a `--panel-ip <YOUR_IP>` placeholder and admin fills manually.
  PANEL_PUBLIC_IP: z.string().ip().optional(),

  // Slice S7 — login bruteforce defence. After this many failed logins
  // for the same username (case-insensitive) within the window, lock the
  // account for LOCKOUT_DURATION_MIN minutes regardless of source IP.
  // Per-IP rate limit is separate (faster, lower threshold).
  LOGIN_LOCKOUT_FAILURES: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_DURATION_MIN: z.coerce.number().int().min(1).default(15),
  LOGIN_LOCKOUT_WINDOW_MIN: z.coerce.number().int().min(1).default(15),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}

export const config: Config = Object.freeze(loadConfig());
