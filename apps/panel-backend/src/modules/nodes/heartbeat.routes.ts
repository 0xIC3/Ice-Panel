import type { FastifyInstance } from 'fastify';
import { prisma } from '../../prisma.js';
import { verifyHeartbeatToken } from './heartbeat-token.js';
import { config } from '../../config.js';

/**
 * Slice 38 — heartbeat self-destruct endpoint.
 *
 * Mounted under `/api/internal/nodes` (no admin auth — agent-only).
 * The agent presents `Authorization: Bearer <token>` from its bootstrap
 * payload. Token is HMAC over (nodeId, heartbeat_secret); the secret
 * lives in `nodes.heartbeat_secret` and never leaves the panel.
 *
 * Status mapping:
 *   200 { status: "active" }    — node is registered and not soft-deleted
 *   200 { status: "disabled" }  — admin explicitly disabled the node
 *                                  (agent should pause activity but NOT
 *                                  self-destruct — admins toggle this)
 *   410 Gone                    — node was deleted; agent self-destructs
 *   401 Unauthorized            — token bad / nodeId unknown / HMAC fail
 *
 * Network errors / 5xx on the agent side are NOT treated as "delete" —
 * the agent only counts explicit 410s. This keeps panel-restart and
 * brief outages from spuriously destroying production nodes.
 */
export async function heartbeatRoutes(app: FastifyInstance): Promise<void> {
  app.get('/me/status', {
    config: {
      // Bad bearers cost a DB roundtrip per request. Cap so a flood from
      // one source can't keep the panel busy. Real agents poll once a
      // minute, so 120/min/IP is generous for legitimate behind-NAT cases.
      rateLimit: {
        max: config.RATE_LIMIT_HEARTBEAT_PER_MIN,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'MISSING_BEARER' });
    }
    const token = auth.slice('Bearer '.length).trim();

    const verified = await verifyHeartbeatToken(token, async (nodeId) => {
      // Only fetch the secret column; we don't need the rest of the row
      // for verification. Soft-deleted rows DO get their secret returned
      // because we want valid-token-but-deleted to return 410, not 401.
      const row = await prisma.node.findUnique({
        where: { id: nodeId },
        select: { heartbeatSecret: true },
      });
      return row ? Buffer.from(row.heartbeatSecret as Uint8Array) : null;
    });

    if (!verified) {
      return reply.code(401).send({ error: 'INVALID_TOKEN' });
    }

    const node = await prisma.node.findUnique({
      where: { id: verified.nodeId },
      select: { deletedAt: true, status: true },
    });

    // findUnique by id on a UUID PK — if verifyHeartbeatToken found a
    // secret it means the row exists. The only way for it to be missing
    // here is a race with delete during this request; treat as Gone.
    if (!node) {
      return reply.code(410).send({ error: 'GONE' });
    }
    if (node.deletedAt) {
      return reply.code(410).send({ error: 'GONE' });
    }
    if (node.status === 'disabled') {
      return reply.send({ status: 'disabled' });
    }
    return reply.send({ status: 'active' });
  });
}
