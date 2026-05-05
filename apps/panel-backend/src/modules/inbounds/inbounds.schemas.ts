import { z } from 'zod';

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, underscore, hyphen');

const PortSchema = z.number().int().min(1).max(65535);

// ───── Per-protocol config schemas ─────

export const HysteriaConfigSchema = z.object({
  /** Optional Salamander obfuscation password. Leave empty for no obfs. */
  obfsPassword: z.string().max(128).optional(),
  /** Local URL Hysteria masquerades to for non-authenticated probers. */
  masqueradeUrl: z.string().url().optional(),
  /** Brutal CC up bandwidth in Mbps (server hint). */
  brutalUpMbps: z.number().int().positive().max(10000).optional(),
  /** Brutal CC down bandwidth in Mbps. */
  brutalDownMbps: z.number().int().positive().max(10000).optional(),
});

export const XrayConfigSchema = z.object({
  /**
   * REALITY target — the legitimate site Xray forwards mismatched probes to.
   * Format `host:port`, e.g. "www.cloudflare.com:443".
   */
  realityDest: z.string().regex(/^[a-zA-Z0-9.-]+:\d{1,5}$/),
  realityServerNames: z.array(z.string().min(1).max(255)).min(1).max(8),
  /** REALITY shortIds — hex strings, max 16 chars each. */
  realityShortIds: z
    .array(z.string().regex(/^[0-9a-fA-F]{0,16}$/))
    .min(1)
    .max(8),
  realityPrivateKey: z.string().min(1).max(128),
  /** REALITY public key paired with privateKey — emitted in client URI. */
  realityPublicKey: z.string().min(1).max(128),
  flow: z.string().max(64).default('xtls-rprx-vision'),
  fingerprint: z.string().max(32).default('chrome'),
});

const ObfuscationSchema = z.object({
  jc: z.number().int().min(0).max(50).default(4),
  jmin: z.number().int().min(0).max(1280).default(40),
  jmax: z.number().int().min(0).max(1280).default(70),
  s1: z.number().int().min(0).max(1280).default(72),
  s2: z.number().int().min(0).max(1280).default(56),
  s3: z.number().int().min(0).max(1280).default(32),
  s4: z.number().int().min(0).max(1280).default(16),
  h1: z.number().int().min(5).default(100),
  h2: z.number().int().min(5).default(200),
  h3: z.number().int().min(5).default(300),
  h4: z.number().int().min(5).default(400),
});

export const AmneziawgConfigSchema = z.object({
  /** Subnet handed to peers, e.g. "10.0.0.0/24". */
  subnet: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/),
  serverPrivateKey: z.string().min(1).max(128),
  /** Public key paired with privateKey — emitted in client config. */
  serverPublicKey: z.string().min(1).max(128),
  obfuscation: ObfuscationSchema,
});

export const NaiveConfigSchema = z.object({
  hostname: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+$/, 'No spaces / scheme — hostname only'),
  tlsEmail: z.string().email(),
  masqueradeRoot: z.string().min(1).max(255).default('/var/www/html'),
});

// Discriminated union over `protocol`. Used for create/update body validation.
export const InboundConfigByProtocol = z.discriminatedUnion('protocol', [
  z.object({ protocol: z.literal('hysteria'), config: HysteriaConfigSchema }),
  z.object({ protocol: z.literal('xray'), config: XrayConfigSchema }),
  z.object({ protocol: z.literal('amneziawg'), config: AmneziawgConfigSchema }),
  z.object({ protocol: z.literal('naive'), config: NaiveConfigSchema }),
]);

const BaseFields = z.object({
  nodeId: z.uuid(),
  name: NameSchema,
  port: PortSchema,
  enabled: z.boolean().default(true),
});

export const CreateInboundSchema = z.intersection(BaseFields, InboundConfigByProtocol);
export type CreateInboundInput = z.infer<typeof CreateInboundSchema>;

// Update never changes `protocol` (would invalidate per-protocol creds and
// break already-issued client URIs). To switch protocols, delete + recreate.
// The new config (if provided) must be the right shape for the existing
// inbound's protocol — service.ts validates that before persisting.
export const UpdateInboundSchema = z.object({
  name: NameSchema.optional(),
  port: PortSchema.optional(),
  enabled: z.boolean().optional(),
  /** Protocol-specific config — must match the existing inbound's protocol. */
  config: z.unknown().optional(),
});
export type UpdateInboundInput = z.infer<typeof UpdateInboundSchema>;

export const PROTOCOL_CONFIG_SCHEMAS = {
  hysteria: HysteriaConfigSchema,
  xray: XrayConfigSchema,
  amneziawg: AmneziawgConfigSchema,
  naive: NaiveConfigSchema,
} as const;

export const ListInboundsQuerySchema = z.object({
  nodeId: z.uuid().optional(),
  protocol: z.enum(['hysteria', 'xray', 'amneziawg', 'naive']).optional(),
});
export type ListInboundsQuery = z.infer<typeof ListInboundsQuerySchema>;

export const InboundIdParamSchema = z.object({ id: z.uuid() });
export type InboundIdParam = z.infer<typeof InboundIdParamSchema>;
