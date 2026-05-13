import { prisma } from '../../prisma.js';
import { NodeTransport, NodeRequestError } from '../nodes/nodes.transport.js';

/**
 * Per-node in-memory snapshot of the last seen cumulative `totalBytesIn/Out`
 * from the agent. Used by the "no per-user accounting" fallback (mtproto +
 * any future single-counter adapter) to compute deltas tick-to-tick. Lives
 * in module scope — cleared when the backend restarts; that's fine, the
 * first tick after restart just records the current snapshot without
 * writing a fake spike.
 */
const totalSnapshot = new Map<string, { in: bigint; out: bigint }>();

/**
 * Poll per-user traffic stats from every online node and roll them into
 * `user_traffic.used_traffic_bytes` (per-user) and `node_usage_history`
 * (per-node, hourly bucket).
 *
 * Agent-side: xray's `api statsquery -reset` returns deltas since last
 * poll; the agent's `GET /stats` endpoint already wraps that. Other cores
 * (Hysteria/AWG/Naive/SS) don't expose per-user counters today — they're
 * absent from the response and silently skipped here.
 *
 * Apply `node.consumptionMultiplier` to the user-side delta so premium
 * regions count more (or less) against per-user limits.
 *
 * Idempotent: on transient failure, skip and try next tick. Never block
 * the cron loop on one slow/down node.
 */
export async function pollNodeStats(): Promise<{ ok: number; failed: number }> {
  const nodes = await prisma.node.findMany({
    where: {
      deletedAt: null,
      status: { notIn: ['disabled', 'unreachable'] },
    },
    select: { id: true, address: true, consumptionMultiplier: true },
  });
  if (nodes.length === 0) return { ok: 0, failed: 0 };

  const now = new Date();
  // Floor to current hour bucket — UTC. node_usage_history has @@id([nodeId, hour]).
  const hourBucket = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
    ),
  );

  let ok = 0;
  let failed = 0;

  await Promise.all(
    nodes.map(async (node) => {
      try {
        const transport = new NodeTransport(node);
        const res = await transport.getStats();
        const rawTotal =
          (res.users ?? []).reduce(
            (acc, u) => acc + (u.bytesIn || 0) + (u.bytesOut || 0),
            0,
          );
        if (rawTotal > 0) {
          console.log(
            `[cron] node-stats-poll ${node.id} — ${res.users.length} entries, total=${rawTotal}B`,
          );
        }
        const multiplier = Number(node.consumptionMultiplier ?? 1) || 1;
        let nodeDownload = 0n;
        let nodeUpload = 0n;
        const userList = res.users ?? [];

        // Per-user: increment used_traffic_bytes by delta * multiplier.
        // Wire format: bytesIn = uplink (user→server), bytesOut = downlink.
        // We sum both into used_traffic_bytes (panel doesn't separate
        // up/down at the user level today; node-level table has both).
        for (const u of userList) {
          const inB = BigInt(u.bytesIn || 0);
          const outB = BigInt(u.bytesOut || 0);
          nodeUpload += inB;
          nodeDownload += outB;
          const userDelta = inB + outB;
          if (userDelta === 0n) continue;
          const scaled =
            multiplier === 1
              ? userDelta
              : BigInt(Math.round(Number(userDelta) * multiplier));

          // upsert — touch onlineAt + lastConnectedNodeId on every poll
          // where the user has ANY traffic so dashboard "active in last
          // N min" counters work without a separate online ping.
          await prisma.userTraffic.upsert({
            where: { userId: u.userId },
            create: {
              userId: u.userId,
              usedTrafficBytes: scaled,
              lifetimeTrafficBytes: scaled,
              onlineAt: now,
              firstConnectedAt: now,
              lastConnectedNodeId: node.id,
            },
            update: {
              usedTrafficBytes: { increment: scaled },
              lifetimeTrafficBytes: { increment: scaled },
              onlineAt: now,
              lastConnectedNodeId: node.id,
            },
          });
        }

        // Per-node hourly bucket — increment current hour's totals.
        //
        // Fallback for protocols without per-user attribution (mtproto:
        // single-secret upstream; same applies to any future adapter that
        // only exposes node-wide counters). When per-user counters sum to
        // zero but the agent reports `totalBytesIn/Out > 0`, treat those
        // as node-level deltas and write them straight into the hourly
        // bucket. We bookkeep the previous total in-memory per-node so
        // we write the *delta* each tick, not the cumulative counter.
        if (nodeDownload === 0n && nodeUpload === 0n) {
          const cumIn = BigInt(res.totalBytesIn || 0);
          const cumOut = BigInt(res.totalBytesOut || 0);
          if (cumIn > 0n || cumOut > 0n) {
            const prev = totalSnapshot.get(node.id) ?? { in: 0n, out: 0n };
            const dIn = cumIn > prev.in ? cumIn - prev.in : 0n;
            const dOut = cumOut > prev.out ? cumOut - prev.out : 0n;
            totalSnapshot.set(node.id, { in: cumIn, out: cumOut });
            nodeUpload += dIn;
            nodeDownload += dOut;
          }
        }

        if (nodeDownload > 0n || nodeUpload > 0n) {
          await prisma.nodeUsageHistory.upsert({
            where: { nodeId_hour: { nodeId: node.id, hour: hourBucket } },
            create: {
              nodeId: node.id,
              hour: hourBucket,
              downloadBytes: nodeDownload,
              uploadBytes: nodeUpload,
            },
            update: {
              downloadBytes: { increment: nodeDownload },
              uploadBytes: { increment: nodeUpload },
            },
          });
        }
        ok++;
      } catch (err) {
        failed++;
        const detail =
          err instanceof NodeRequestError
            ? `${err.status} ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        console.log(`[cron] node-stats-poll ${node.id} FAILED: ${detail}`);
      }
    }),
  );

  return { ok, failed };
}
