import { prisma } from '../../prisma.js';
import { eventBus } from '../../lib/event-bus.js';

type ResetStrategy = 'day' | 'week' | 'month';

const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Reset usedTrafficBytes for active users with the given strategy.
 * Returns the count of users whose traffic was reset.
 */
export async function resetTrafficForStrategy(strategy: ResetStrategy): Promise<number> {
  const users = await prisma.user.findMany({
    where: { trafficLimitStrategy: strategy, deletedAt: null },
    select: { id: true, traffic: { select: { usedTrafficBytes: true } } },
  });

  if (users.length === 0) return 0;

  await prisma.userTraffic.updateMany({
    where: { userId: { in: users.map((u) => u.id) } },
    data: { usedTrafficBytes: 0n, lastTrafficResetAt: new Date() },
  });

  for (const u of users) {
    eventBus.emit('user.traffic-reset', {
      userId: u.id,
      previousUsedBytes: u.traffic?.usedTrafficBytes ?? 0n,
    });
  }
  return users.length;
}

/**
 * Reset traffic for rolling-30d users whose lastTrafficResetAt is >30d ago (or never).
 * Cross-table + null logic → raw SQL.
 */
export async function resetTrafficRolling(): Promise<number> {
  const cutoff = new Date(Date.now() - ROLLING_WINDOW_MS);

  const rows = await prisma.$queryRaw<
    { id: string; previous_used: bigint | null }[]
  >`
    SELECT u.id::text AS id, ut.used_traffic_bytes AS previous_used
    FROM users u
    LEFT JOIN user_traffic ut ON u.id = ut.user_id
    WHERE u.traffic_limit_strategy = 'rolling'
      AND u.deleted_at IS NULL
      AND (ut.last_traffic_reset_at IS NULL OR ut.last_traffic_reset_at < ${cutoff})
  `;

  if (rows.length === 0) return 0;

  await prisma.userTraffic.updateMany({
    where: { userId: { in: rows.map((r) => r.id) } },
    data: { usedTrafficBytes: 0n, lastTrafficResetAt: new Date() },
  });

  for (const r of rows) {
    eventBus.emit('user.traffic-reset', {
      userId: r.id,
      previousUsedBytes: r.previous_used ?? 0n,
    });
  }
  return rows.length;
}

/**
 * Find active users whose expire_at has passed and flip them to 'expired'.
 * Emits user.status-changed → handler chain enqueues removeUser job.
 */
export async function findExpiredUsers(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { expireAt: { lt: new Date() }, status: 'active', deletedAt: null },
    select: { id: true },
  });

  if (users.length === 0) return 0;

  const ids = users.map((u) => u.id);
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { status: 'expired' },
  });

  for (const id of ids) {
    eventBus.emit('user.status-changed', { userId: id, from: 'active', to: 'expired' });
  }
  return ids.length;
}

/**
 * Find active users whose used traffic >= traffic_limit_bytes; flip to 'limited'.
 * Cross-column comparison → raw SQL.
 */
export async function findExceededTrafficUsers(): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT u.id::text AS id
    FROM users u
    JOIN user_traffic ut ON u.id = ut.user_id
    WHERE u.status = 'active'
      AND u.deleted_at IS NULL
      AND u.traffic_limit_bytes IS NOT NULL
      AND ut.used_traffic_bytes >= u.traffic_limit_bytes
  `;

  if (rows.length === 0) return 0;

  const ids = rows.map((r) => r.id);
  await prisma.user.updateMany({
    where: { id: { in: ids } },
    data: { status: 'limited' },
  });

  for (const id of ids) {
    eventBus.emit('user.status-changed', { userId: id, from: 'active', to: 'limited' });
  }
  return ids.length;
}
