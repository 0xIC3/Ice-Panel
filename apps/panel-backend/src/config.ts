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
  // Loose validation: any non-empty token. Operator controls this, no
  // injection vector — UFW will reject malformed IPs at allow-time.
  PANEL_PUBLIC_IP: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),

  // Slice S7 — login bruteforce defence. After this many failed logins
  // for the same username (case-insensitive) within the window, lock the
  // account for LOCKOUT_DURATION_MIN minutes regardless of source IP.
  // Per-IP rate limit is separate (faster, lower threshold).
  LOGIN_LOCKOUT_FAILURES: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_DURATION_MIN: z.coerce.number().int().min(1).default(15),
  LOGIN_LOCKOUT_WINDOW_MIN: z.coerce.number().int().min(1).default(15),

  // ACME contact email used by node-installers that need a Let's Encrypt
  // cert (Hysteria 2 / NaiveProxy / Caddy). Optional — install command
  // emits a placeholder when unset, admin fills manually.
  ACME_DEFAULT_EMAIL: z.email().optional(),

  // Tier-1 security — Telegram alert webhook (cycle #5 SECURITY.md).
  // When BOT_TOKEN + CHAT_ID are both set, the panel pushes notifications
  // for high-signal security events:
  //   - admin login success / lockout / failed lockout
  //   - node self-destruct trigger
  //   - node bootstrap token issued
  // Optional — when either is unset, calls to `notifyTelegram` are no-ops.
  // Get a bot token from @BotFather; chat_id from @userinfobot.
  TELEGRAM_BOT_TOKEN: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  TELEGRAM_CHAT_ID: z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),

  // Tier-1 security — admin geo-block. CSV list of ISO 3166-1 alpha-2
  // country codes allowed on `/api/*` routes EXCEPT the public-by-design
  // ones (subscription, heartbeat, bootstrap). Empty → disabled (any
  // country allowed). The country is read from `CF-IPCountry` (Cloudflare
  // edge header) and falls back to `X-Country-Code` if a non-Cloudflare
  // front-edge wants to opt in. When the header is missing entirely on a
  // gated request we DENY (fail-closed). Cloudflare orange-cloud is a
  // hard prerequisite for this control.
  ADMIN_ALLOWED_COUNTRIES: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter((s) => /^[A-Z]{2}$/.test(s))
        : [],
    ),

  // Tier-1 security — honey-route blacklist TTL (seconds). When an IP
  // hits a known scanner path (/wp-admin, /.env, ...), we surface a
  // plausible fake response AND add the IP to `sec:blacklist:<ip>` in
  // Redis for this duration. Subsequent requests from that IP get a
  // fast 403 before any business logic runs. 3600s = 1h is a reasonable
  // default — long enough to wear a scanner down, short enough that a
  // legit user on a shared-NAT egress isn't permanently shut out.
  HONEYPOT_BLACKLIST_TTL_SEC: z.coerce.number().int().min(60).default(3600),

  // Tier-1 security — honey subscription tokens. CSV of tokens admin
  // deliberately places in suspicious channels (pastebins, screenshots,
  // semi-public Telegram chats) as a leak tripwire. ANY hit on
  // `/sub/<honey>` fires a Telegram alert with source IP + UA + path,
  // returns a plausible empty subscription, and blacklists the source
  // IP for HONEYPOT_BLACKLIST_TTL_SEC. The token never matches a real
  // user. Empty list → feature disabled.
  HONEY_USER_TOKENS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length >= 8 && s.length <= 128)
        : [],
    ),
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
