import { config } from '../../config.js';
import { prisma } from '../../prisma.js';
import { parseEnabledProtocols } from '../users/users.mapper.js';
import {
  buildHysteriaUri,
  buildSubscriptionJson,
  buildVlessRealityUri,
  encodePlainList,
  hostFromAddress,
  type SubscriptionEndpoint,
  type SubscriptionJsonResponse,
} from './subscription.formats.js';

// ───── Domain errors ─────

export class SubscriptionNotFoundError extends Error {
  constructor() {
    super('Subscription not found');
    this.name = 'SubscriptionNotFoundError';
  }
}

export class SubscriptionForbiddenError extends Error {
  constructor(public reason: 'REVOKED' | 'DISABLED' | 'EXPIRED' | 'LIMITED') {
    super(`Subscription is ${reason.toLowerCase()}`);
    this.name = 'SubscriptionForbiddenError';
  }
}

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface SubscriptionResult {
  /** Raw endpoint list — feed into format-specific builders. */
  endpoints: SubscriptionEndpoint[];
  /** Base64 plain-list (universal client format). */
  textPlain: string;
  /** Structured JSON for IcePath-VPN bot / Ice-Client. */
  json: SubscriptionJsonResponse;
}

interface XrayPanelConfig {
  port: number;
  publicKey: string;
  shortId: string;
  sni: string;
  flow: string;
  fingerprint: string;
}

/**
 * Returns Xray panel-side config if all REALITY parameters are set, else null.
 * When null, users with `enabledProtocols=['xray']` simply get no xray
 * endpoints (panel can't construct a valid VLESS URI without the public key,
 * shortId, and SNI). Slice 23 will replace env-driven config with per-inbound
 * DB rows.
 */
function getXrayPanelConfig(): XrayPanelConfig | null {
  if (
    !config.XRAY_REALITY_PUBLIC_KEY ||
    !config.XRAY_REALITY_SHORT_ID ||
    !config.XRAY_REALITY_SNI
  ) {
    return null;
  }
  return {
    port: config.XRAY_PUBLIC_PORT,
    publicKey: config.XRAY_REALITY_PUBLIC_KEY,
    shortId: config.XRAY_REALITY_SHORT_ID,
    sni: config.XRAY_REALITY_SNI,
    flow: config.XRAY_FLOW,
    fingerprint: config.XRAY_FINGERPRINT,
  };
}

/**
 * Resolve a subscription token to a list of per-node endpoints, in both
 * universal (base64 plain list) and structured (JSON) forms.
 *
 * Endpoint emission rules:
 *   - Iterate every active node × user.enabledProtocols
 *   - `'hysteria'` always emits (creds always pre-generated, port is global)
 *   - `'xray'` emits only when XRAY_REALITY_* env config is complete
 *   - `'amneziawg'` / `'naive'` are not yet implemented (slices 19/20)
 *
 * Side effect: writes a row to `subscription_request_history` for audit.
 * Failures of that write are logged but do not fail the request.
 */
export async function generateSubscription(
  token: string,
  ctx: RequestContext = {},
): Promise<SubscriptionResult> {
  const user = await prisma.user.findFirst({
    where: { subscriptionToken: token, deletedAt: null },
    include: { traffic: true },
  });
  if (!user) throw new SubscriptionNotFoundError();

  if (user.subRevokedAt) throw new SubscriptionForbiddenError('REVOKED');
  switch (user.status) {
    case 'active':
      break;
    case 'disabled':
      throw new SubscriptionForbiddenError('DISABLED');
    case 'expired':
      throw new SubscriptionForbiddenError('EXPIRED');
    case 'limited':
      throw new SubscriptionForbiddenError('LIMITED');
    default:
      throw new SubscriptionForbiddenError('DISABLED');
  }

  const nodes = await prisma.node.findMany({
    where: { deletedAt: null, status: { not: 'disabled' } },
    select: { id: true, name: true, address: true },
    orderBy: { createdAt: 'asc' },
  });

  const enabled = new Set(parseEnabledProtocols(user.enabledProtocols));
  const xrayCfg = enabled.has('xray') ? getXrayPanelConfig() : null;

  const endpoints: SubscriptionEndpoint[] = [];
  for (const n of nodes) {
    const host = hostFromAddress(n.address);

    if (enabled.has('hysteria')) {
      endpoints.push({
        protocol: 'hysteria',
        nodeName: n.name,
        host,
        port: config.HYSTERIA_PUBLIC_PORT,
        password: user.hysteriaPassword,
        uri: buildHysteriaUri({
          password: user.hysteriaPassword,
          host,
          port: config.HYSTERIA_PUBLIC_PORT,
          name: n.name,
        }),
      });
    }

    if (xrayCfg && user.xrayUuid) {
      endpoints.push({
        protocol: 'xray',
        nodeName: n.name,
        host,
        port: xrayCfg.port,
        uuid: user.xrayUuid,
        publicKey: xrayCfg.publicKey,
        shortId: xrayCfg.shortId,
        sni: xrayCfg.sni,
        flow: xrayCfg.flow,
        fingerprint: xrayCfg.fingerprint,
        uri: buildVlessRealityUri({
          uuid: user.xrayUuid,
          host,
          port: xrayCfg.port,
          publicKey: xrayCfg.publicKey,
          shortId: xrayCfg.shortId,
          sni: xrayCfg.sni,
          flow: xrayCfg.flow,
          fingerprint: xrayCfg.fingerprint,
          name: n.name,
        }),
      });
    }
  }

  try {
    await prisma.subscriptionRequestHistory.create({
      data: {
        userId: user.id,
        requestIp: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
  } catch {
    // Audit failure must not block the subscription response.
  }

  return {
    endpoints,
    textPlain: encodePlainList(endpoints.map((e) => e.uri)),
    json: buildSubscriptionJson(user, endpoints),
  };
}
