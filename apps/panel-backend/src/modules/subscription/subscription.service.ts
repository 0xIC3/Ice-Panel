import { prisma } from '../../prisma.js';
import { parseEnabledProtocols } from '../users/users.mapper.js';
import { allocatePeer } from '../amneziawg/amneziawg.service.js';
import { buildNaiveUri } from '../../core-adapters/naive/index.js';
import {
  buildHysteriaUri,
  buildMieruUri,
  buildMtprotoTmeUri,
  buildMtprotoUri,
  buildShadowsocksUri,
  buildSubscriptionJson,
  buildTrojanRealityUri,
  buildVlessRealityUri,
  encodePlainList,
  hostFromAddress,
  mtprotoSecret,
  type ShadowsocksMethod,
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
  endpoints: SubscriptionEndpoint[];
  textPlain: string;
  json: SubscriptionJsonResponse;
}

// ───── Per-protocol config shapes (mirror inbounds.schemas.ts) ─────

interface XrayInboundConfig {
  realityDest: string;
  realityServerNames: string[];
  realityShortIds: string[];
  realityPrivateKey: string;
  realityPublicKey: string;
  flow: string;
  fingerprint: string;
  network: 'raw' | 'xhttp' | 'ws' | 'grpc';
  path?: string;
  host?: string;
  serviceName?: string;
}

interface AmneziawgObfuscation {
  jc: number;
  jmin: number;
  jmax: number;
  s1: number;
  s2: number;
  s3: number;
  s4: number;
  h1: number;
  h2: number;
  h3: number;
  h4: number;
}

interface AmneziawgInboundConfig {
  subnet: string;
  serverPrivateKey: string;
  serverPublicKey: string;
  obfuscation: AmneziawgObfuscation;
}

interface NaiveInboundConfig {
  hostname: string;
  tlsEmail: string;
  masqueradeRoot: string;
}

/**
 * Resolve a subscription token to a list of per-inbound endpoints.
 *
 * Walks every enabled inbound on every active node, filters by the user's
 * `enabledProtocols`, and emits one structured endpoint per match. The
 * endpoint shape carries everything the format-specific builders (clash /
 * singbox / wgconf / xrayjson) need; the route handler picks the format.
 *
 * AmneziaWG IP allocation is lazy: the first time a user hits an AmneziaWG
 * inbound their IP gets persisted in `amneziawg_peers`. Subsequent calls
 * return the same row.
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

  const enabled = new Set(parseEnabledProtocols(user.enabledProtocols));

  // Slice 26 — Squad ACL. Inbounds visible to the user are the UNION of
  // inbounds attached to every group the user is a member of. If the user
  // has zero memberships the subscription is empty (createUser auto-adds
  // them to "All", so this is unreachable through the normal API path —
  // but we don't want a panic if someone clears memberships via raw SQL).
  const inbounds = await prisma.inbound.findMany({
    where: {
      enabled: true,
      node: { deletedAt: null, status: { not: 'disabled' } },
      groupInbounds: {
        some: {
          group: {
            members: { some: { userId: user.id } },
          },
        },
      },
    },
    include: { node: { select: { name: true, address: true } } },
    orderBy: [{ node: { createdAt: 'asc' } }, { port: 'asc' }],
  });

  const endpoints: SubscriptionEndpoint[] = [];
  for (const ib of inbounds) {
    if (!enabled.has(ib.protocol as never)) continue;

    // Slice 25 — `publicHost` and `publicPort` on the inbound override the
    // historic fallback (`hostFromAddress(node.address)` / `inbound.port`).
    // Lets admins keep `node.address` as the mTLS-only control-plane endpoint
    // (often a bare IP) while emitting a real FQDN to clients.
    const host = ib.publicHost ?? hostFromAddress(ib.node.address);
    const port = ib.publicPort ?? ib.port;
    const nodeName = ib.node.name;

    if (ib.protocol === 'hysteria') {
      const hyCfg = ib.config as { obfsPassword?: string } | null;
      endpoints.push({
        protocol: 'hysteria',
        nodeName,
        host,
        port,
        password: user.hysteriaPassword,
        obfsPassword: hyCfg?.obfsPassword,
        uri: buildHysteriaUri({
          password: user.hysteriaPassword,
          host,
          port,
          name: nodeName,
          obfsPassword: hyCfg?.obfsPassword,
        }),
      });
    } else if (ib.protocol === 'xray' && user.xrayUuid) {
      const cfg = ib.config as unknown as XrayInboundConfig & {
        subprotocol?: 'vless' | 'trojan';
      };
      const sni = cfg.realityServerNames[0] ?? '';
      const shortId = cfg.realityShortIds[0] ?? '';
      const network = cfg.network ?? 'raw';
      const subprotocol = cfg.subprotocol ?? 'vless';
      // Slice 24c part 3 — branch URI scheme on subprotocol. We reuse
      // user.xrayUuid as the Trojan password (UUIDs have plenty of entropy
      // and admins are already managing them; a separate trojanPassword
      // column would be redundant credential management).
      const uri =
        subprotocol === 'trojan'
          ? buildTrojanRealityUri({
              password: user.xrayUuid,
              host,
              port,
              publicKey: cfg.realityPublicKey,
              shortId,
              sni,
              fingerprint: cfg.fingerprint,
              network,
              path: cfg.path,
              hostHeader: cfg.host,
              serviceName: cfg.serviceName,
              name: nodeName,
            })
          : buildVlessRealityUri({
              uuid: user.xrayUuid,
              host,
              port,
              publicKey: cfg.realityPublicKey,
              shortId,
              sni,
              flow: cfg.flow,
              fingerprint: cfg.fingerprint,
              network,
              path: cfg.path,
              hostHeader: cfg.host,
              serviceName: cfg.serviceName,
              name: nodeName,
            });
      endpoints.push({
        protocol: 'xray',
        nodeName,
        host,
        port,
        uuid: user.xrayUuid,
        publicKey: cfg.realityPublicKey,
        shortId,
        sni,
        flow: cfg.flow,
        fingerprint: cfg.fingerprint,
        network,
        path: cfg.path,
        hostHeader: cfg.host,
        serviceName: cfg.serviceName,
        subprotocol,
        uri,
      });
    } else if (ib.protocol === 'amneziawg' && user.amneziawgPrivateKey) {
      const cfg = ib.config as unknown as AmneziawgInboundConfig;
      const peer = await allocatePeer(ib.id, user.id, cfg.subnet);
      endpoints.push({
        protocol: 'amneziawg',
        nodeName,
        host,
        port,
        privateKey: user.amneziawgPrivateKey,
        allowedIp: `${peer.ip}/32`,
        serverPublicKey: cfg.serverPublicKey,
        jc: cfg.obfuscation.jc,
        jmin: cfg.obfuscation.jmin,
        jmax: cfg.obfuscation.jmax,
        s1: cfg.obfuscation.s1,
        s2: cfg.obfuscation.s2,
        s3: cfg.obfuscation.s3,
        s4: cfg.obfuscation.s4,
        h1: cfg.obfuscation.h1,
        h2: cfg.obfuscation.h2,
        h3: cfg.obfuscation.h3,
        h4: cfg.obfuscation.h4,
        // No standardised URI format for AmneziaWG; clients fetch ?format=wgconf.
        uri: '',
      });
    } else if (ib.protocol === 'mtproto' && user.xrayUuid) {
      // Slice 41 — Telegram MTProto. Per-user secret deterministically
      // derived from (xrayUuid, domain). Domain change rotates every
      // user's secret — flagged in admin UI.
      const cfg = ib.config as unknown as { domain: string };
      const secret = mtprotoSecret(user.xrayUuid, cfg.domain);
      endpoints.push({
        protocol: 'mtproto',
        nodeName,
        host,
        port,
        secret,
        domain: cfg.domain,
        uri: buildMtprotoUri({ secret, host, port, name: nodeName }),
        tmeUri: buildMtprotoTmeUri({ secret, host, port }),
      });
    } else if (ib.protocol === 'mieru' && user.xrayUuid) {
      // Slice 40 — Mieru. Username = panel username for log-readability;
      // password = xrayUuid (no extra credential surface).
      const cfg = ib.config as unknown as { mtu: number };
      endpoints.push({
        protocol: 'mieru',
        nodeName,
        host,
        port,
        username: user.username,
        password: user.xrayUuid,
        mtu: cfg.mtu,
        uri: buildMieruUri({
          username: user.username,
          password: user.xrayUuid,
          host,
          port,
          mtu: cfg.mtu,
          name: nodeName,
        }),
      });
    } else if (ib.protocol === 'shadowsocks' && user.xrayUuid) {
      // Slice 24d — Shadowsocks (SS2022). Per-user password reuses
      // user.xrayUuid: UUIDs have plenty of entropy and admins are already
      // managing them; growing user.shadowsocksPassword would just be
      // another credential row that's never independent of xrayUuid in
      // practice.
      const cfg = ib.config as unknown as { method: ShadowsocksMethod };
      endpoints.push({
        protocol: 'shadowsocks',
        nodeName,
        host,
        port,
        method: cfg.method,
        password: user.xrayUuid,
        uri: buildShadowsocksUri({
          method: cfg.method,
          password: user.xrayUuid,
          host,
          port,
          name: nodeName,
        }),
      });
    } else if (ib.protocol === 'naive' && user.naivePassword) {
      const cfg = ib.config as unknown as NaiveInboundConfig;
      // Public host for naive is the inbound's TLS hostname, not the panel's
      // node.address (Caddy answers ACME on `cfg.hostname`).
      const naiveHost = cfg.hostname || host;
      endpoints.push({
        protocol: 'naive',
        nodeName,
        host: naiveHost,
        port,
        username: user.username,
        password: user.naivePassword,
        uri: buildNaiveUri({
          username: user.username,
          password: user.naivePassword,
          host: naiveHost,
          port,
          name: nodeName,
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
