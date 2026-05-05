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
