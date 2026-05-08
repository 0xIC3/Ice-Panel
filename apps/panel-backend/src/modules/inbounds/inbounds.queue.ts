import { Queue, Worker, type Job } from 'bullmq';
import type { ApplyInboundsRequest, InboundDto, ProtocolName } from '@ice-panel/shared';
import { redis } from '../../lib/redis.js';
import { prisma } from '../../prisma.js';
import { mtprotoSecret } from '../../core-adapters/mtproto/index.js';
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
    // Coalescing uses `jobId: apply-<nodeId>` so duplicate enqueues collapse
    // into one push. BUT BullMQ's deduplication treats a failed job in the
    // failed-set as still "owning" the jobId — new enqueues become silent
    // no-ops until the failed job is reaped. With `age: 86400` that's a
    // 24-hour deadlock per node after a single transient failure (panel
    // rebuilds, network blips, mTLS hiccups during cert rotation).
    //
    // Fix: drop failed jobs immediately. Operators see retries via the
    // `[worker:inbound-sync] applyInbounds X FAILED: ...` console.log
    // before the final retry; long-term failures will re-enqueue on the
    // next event (binding/profile change), which is the right behaviour.
    removeOnFail: true,
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
  // Slice 27 — walks ProfileNodeBinding rows joined to Profile, and resolves
  // the deployable config for each. Replaces the old per-node `inbounds`
  // table read while keeping the wire format identical (the node-agent
  // doesn't know about profile/binding split — it just gets a flat list).
  const bindings = await prisma.profileNodeBinding.findMany({
    where: {
      nodeId,
      enabled: true,
      profile: { enabled: true },
    },
    include: {
      profile: {
        select: { id: true, name: true, protocol: true, config: true },
      },
    },
    orderBy: { port: 'asc' },
  });

  return bindings.map((b) => {
    // Shallow merge: per-binding overrides win over profile.config. Used for
    // ACME domain, AmneziaWG private key, Shadowsocks server PSK, etc.
    const baseConfig = (b.profile.config ?? {}) as Record<string, unknown>;
    const overrides = (b.overrides ?? {}) as Record<string, unknown>;
    let config = { ...baseConfig, ...overrides } as InboundDto['config'];

    // Slice 41 — mtproto secret derived from (binding.id, domain). Both
    // the wire push (here) and subscription generator key on binding.id so
    // the secret stays in lock-step on both sides.
    if (b.profile.protocol === 'mtproto') {
      const cfg = config as { domain?: string };
      if (cfg && cfg.domain) {
        config = {
          ...cfg,
          secret: mtprotoSecret(b.id, cfg.domain),
        } as InboundDto['config'];
      }
    }

    return {
      id: b.id,
      name: b.profile.name,
      protocol: b.profile.protocol as ProtocolName,
      port: b.port,
      config,
    };
  });
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
