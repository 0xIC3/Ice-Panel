import { prisma } from '../../prisma.js';
import {
  buildHysteriaUri,
  buildSubscriptionJson,
  encodePlainList,
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
  textPlain: string;
  json: SubscriptionJsonResponse;
}

/**
 * Resolve a subscription token to a list of per-node endpoints, in both
 * universal (base64 plain list) and structured (JSON) forms.
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

  // Slice 12 MVP: every active node serves Hysteria. Slice 13+ will filter
  // by group → group_inbounds → inbounds once inbound CRUD lands.
  const nodes = await prisma.node.findMany({
    where: { deletedAt: null, status: { not: 'disabled' } },
    select: { id: true, name: true, address: true },
    orderBy: { createdAt: 'asc' },
  });

  const endpoints: SubscriptionEndpoint[] = nodes.map((n) => ({
    protocol: 'hysteria',
    nodeName: n.name,
    uri: buildHysteriaUri({
      password: user.hysteriaPassword,
      address: n.address,
      name: n.name,
    }),
  }));

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
    textPlain: encodePlainList(endpoints.map((e) => e.uri)),
    json: buildSubscriptionJson(user, endpoints),
  };
}
