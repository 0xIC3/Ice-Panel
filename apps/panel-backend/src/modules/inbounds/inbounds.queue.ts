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
    removeOnComplete: true,
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

interface ActiveUser {
  id: string;
  shortId: string;
  username: string;
  xrayUuid: string;
  hysteriaPassword: string;
  amneziawgPublicKey: string;
  naivePassword: string;
}

async function fetchActiveUsers(): Promise<ActiveUser[]> {
  const now = new Date();
  return prisma.user.findMany({
    where: {
      status: 'active',
      OR: [{ expireAt: null }, { expireAt: { gt: now } }],
    },
    select: {
      id: true,
      shortId: true,
      username: true,
      xrayUuid: true,
      hysteriaPassword: true,
      amneziawgPublicKey: true,
      naivePassword: true,
    },
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
      publicHost: true,
      publicPort: true,
      config: true,
    },
    orderBy: { port: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    protocol: r.protocol as ProtocolName,
    // The node-agent gets the actual listen port (what xray/hysteria binds
    // to). publicPort is purely for client-URL emission and lives only on
    // the panel side, so we don't ship it across the wire.
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

  const transport = new NodeTransport(node);

  try {
    const res = await transport.applyInbounds(req);
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

  // Push all active users so protocol servers (xray, hysteria, etc.) have
  // an up-to-date client list. addUser is idempotent on the node side.
  if (inbounds.length === 0) return;

  const users = await fetchActiveUsers();
  console.log(
    `[worker:inbound-sync] pushing ${users.length} user(s) to ${node.name}`,
  );
  for (const u of users) {
    try {
      await transport.addUser({
        userId: u.id,
        shortId: u.shortId,
        username: u.username,
        credentials: {
          xrayUuid: u.xrayUuid,
          hysteriaPassword: u.hysteriaPassword,
          amneziawgPublicKey: u.amneziawgPublicKey,
          naivePassword: u.naivePassword,
        },
      });
    } catch (err) {
      // Log but don't throw — one failed user shouldn't block the rest.
      const detail = err instanceof Error ? err.message : String(err);
      console.log(`[worker:inbound-sync] addUser ${u.username} to ${node.name} FAILED: ${detail}`);
    }
  }
  console.log(`[worker:inbound-sync] user sync to ${node.name} done`);
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
