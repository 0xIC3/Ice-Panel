import { Queue, Worker, type Job } from 'bullmq';
import type { ApplyInboundsRequest, InboundDto, ProtocolName } from '@ice-panel/shared';
import { redis } from '../../lib/redis.js';
import { prisma } from '../../prisma.js';
import { NodeTransport, NodeRequestError } from '../nodes/nodes.transport.js';

// ───── Job data shapes ─────

export interface ApplyNodeInboundsJobData {
  /** Which node's inbound set to recompute and push. */
  nodeId: string;
}

// ───── Queue ─────

const QUEUE_NAME = 'inbound-sync';

export const inboundSyncQueue = new Queue<ApplyNodeInboundsJobData>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    // Two retries (exponential 1 s / 2 s). Inbound config push is idempotent
    // by design so retrying is always safe; we stop sooner than addUser
    // because applyInbounds restarts the protocol server and stacking
    // restarts on a flaky network is louder than stacking addUser noops.
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: { age: 86400 },
  },
});

// ───── Sync helper ─────

interface NodeRow {
  id: string;
  name: string;
  address: string;
}

async function fetchNode(nodeId: string): Promise<NodeRow | null> {
  return prisma.node.findFirst({
    where: { id: nodeId, deletedAt: null, status: { not: 'disabled' } },
    select: { id: true, name: true, address: true },
  });
}

async function fetchEnabledInbounds(nodeId: string): Promise<InboundDto[]> {
  const rows = await prisma.inbound.findMany({
    where: { nodeId, enabled: true },
    select: {
      id: true,
      name: true,
      protocol: true,
      port: true,
      config: true,
    },
    orderBy: { port: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    protocol: r.protocol as ProtocolName,
    port: r.port,
    // Prisma returns Json as `unknown`; the panel-side service has already
    // validated the shape via Zod when the inbound was created/updated.
    config: r.config as InboundDto['config'],
  }));
}

/**
 * Compute the current set of enabled inbounds for `nodeId` and push it to
 * that node-agent over mTLS. Idempotent (the node-side endpoint diffs).
 *
 * Slice 24 — replaces the manual `/etc/ice-panel-node/env` editing dance
 * caught during the 2026-05-06 VPS test.
 */
export async function applyInboundsForNode(nodeId: string): Promise<void> {
  const node = await fetchNode(nodeId);
  if (!node) {
    console.log(`[worker:inbound-sync] applyInbounds ${nodeId} — node not active, skipping`);
    return;
  }

  const inbounds = await fetchEnabledInbounds(nodeId);
  const req: ApplyInboundsRequest = { inbounds };

  console.log(
    `[worker:inbound-sync] applyInbounds ${node.name} — pushing ${inbounds.length} inbound(s)`,
  );

  try {
    const res = await new NodeTransport(node).applyInbounds(req);
    console.log(
      `[worker:inbound-sync] applyInbounds ${node.name} ok — applied=${res.applied} skipped=${res.skipped}`,
    );
  } catch (err) {
    const detail =
      err instanceof NodeRequestError
        ? `${err.status} ${err.message}`
        : err instanceof Error
        ? err.message
        : String(err);
    console.log(`[worker:inbound-sync] applyInbounds ${node.name} FAILED: ${detail}`);
    throw err;
  }
}

// ───── Worker ─────

export function startInboundSyncWorker(): Worker<ApplyNodeInboundsJobData> {
  return new Worker<ApplyNodeInboundsJobData>(
    QUEUE_NAME,
    async (job: Job<ApplyNodeInboundsJobData>) => {
      switch (job.name) {
        case 'applyNodeInbounds': {
          await applyInboundsForNode(job.data.nodeId);
          break;
        }
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
    },
    {
      connection: redis,
      // One node at a time per worker — applyInbounds restarts the protocol
      // server, parallel restarts on the same node would race. Different
      // nodes can still go in parallel because they're distinct job IDs.
      concurrency: 5,
    },
  );
}
