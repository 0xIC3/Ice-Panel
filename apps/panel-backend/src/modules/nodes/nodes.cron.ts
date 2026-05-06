import { prisma } from '../../prisma.js';
import { NodeTransport, NodeRequestError } from './nodes.transport.js';

/**
 * Poll every active node's `/healthz` over mTLS and update `nodes.status`
 * + `lastStatusChange` + `lastStatusMessage`. Runs on a 30-second cron tick.
 *
 * Status mapping:
 *   - HTTP 200 + body.status === "ok"        → "online"
 *   - HTTP 200 + body.status === "degraded"  → "unreachable" (subprocess down etc.)
 *   - any error / timeout                    → "unreachable"
 *
 * `disabled` is admin-managed and never overwritten here. Soft-deleted nodes
 * are excluded by the same `deletedAt: null` filter we use for fan-out.
 *
 * Slice 23.1 — added after VPS test 2026-05-06, where the panel never lifted
 * a freshly-installed node out of `unknown` because no poller existed.
 */
export async function pollNodeStatuses(): Promise<{ ok: number; down: number }> {
  const nodes = await prisma.node.findMany({
    where: { deletedAt: null, status: { not: 'disabled' } },
    select: { id: true, name: true, address: true, status: true },
  });

  if (nodes.length === 0) return { ok: 0, down: 0 };

  let ok = 0;
  let down = 0;

  await Promise.all(
    nodes.map(async (node) => {
      const result = await checkOne(node);
      if (result.status === 'online') ok++;
      else down++;
      // Only write to DB when the status string actually changes — keeps
      // `lastStatusChange` meaningful and avoids row-write churn on every tick.
      if (result.status !== node.status || result.message) {
        await prisma.node.update({
          where: { id: node.id },
          data: {
            status: result.status,
            lastStatusChange: result.status !== node.status ? new Date() : undefined,
            lastStatusMessage: result.message,
          },
        });
      }
    }),
  );

  return { ok, down };
}

interface PollResult {
  status: 'online' | 'unreachable';
  message: string | null;
}

async function checkOne(node: {
  id: string;
  name: string;
  address: string;
}): Promise<PollResult> {
  try {
    const transport = new NodeTransport(node);
    const res = await transport.healthcheck();
    if (res.status === 'ok') {
      return { status: 'online', message: null };
    }
    // node-agent itself is up but reports degraded (one of the cores down)
    return {
      status: 'unreachable',
      message: `degraded: ${JSON.stringify(res).slice(0, 160)}`,
    };
  } catch (err) {
    if (err instanceof NodeRequestError) {
      return { status: 'unreachable', message: `${err.status} ${err.message}`.slice(0, 200) };
    }
    return {
      status: 'unreachable',
      message: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    };
  }
}
