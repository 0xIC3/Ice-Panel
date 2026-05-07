import type { HostMetricsResponse } from '@ice-panel/shared';
import { prisma } from '../../prisma.js';
import { collectSystemMetrics, type SystemMetrics } from './system-metrics.js';
import { readCachedNodeMetrics } from '../nodes/nodes.cron.js';

const ONLINE_NOW_WINDOW_MS = 3 * 60 * 1000;
const TOP_USERS_LIMIT = 5;
const RECENT_EVENTS_LIMIT = 10;

export interface DashboardOverview {
  users: {
    total: number;
    byStatus: Record<string, number>;
    onlineNow: number;
    onlineToday: number;
    onlineThisWeek: number;
    neverOnline: number;
  };
  traffic: {
    todayBytes: number;
    yesterdayBytes: number;
    last7dBytes: number;
    last30dBytes: number;
    calendarMonthBytes: number;
    currentYearBytes: number;
    last24hHourly: { hour: string; bytes: number }[];
  };
  system: {
    onlineNodeCount: number;
    totalNodeCount: number;
  };
  host: SystemMetrics;
  nodes: {
    id: string;
    name: string;
    address: string;
    protocol: string;
    status: string;
    countryCode: string | null;
    lastStatusChange: string | null;
    inboundCount: number;
    todayBytes: number;
    /** Latest /metrics snapshot pulled from this node, or null if cache cold
     *  / TTL'd / node unreachable. Cache TTL is 60s, poll cadence is 15s. */
    metrics: HostMetricsResponse | null;
  }[];
  byProtocol: {
    protocol: string;
    inboundCount: number;
    enabledUserCount: number;
  }[];
  topUsersToday: {
    id: string;
    username: string;
    bytes: number;
  }[];
  recentEvents: {
    id: string;
    eventType: string;
    userId: string;
    username: string | null;
    createdAt: string;
  }[];
}

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function startOfYesterday(): Date {
  const d = startOfToday();
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function startOfWeek(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d;
}

function startOfMonth(): Date {
  const d = startOfToday();
  d.setUTCDate(d.getUTCDate() - 30);
  return d;
}

function startOfCalendarMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function startOfYear(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

async function sumNodeUsageSince(since: Date, until?: Date): Promise<number> {
  const where: { hour: { gte: Date; lt?: Date } } = { hour: { gte: since } };
  if (until) where.hour.lt = until;
  const agg = await prisma.nodeUsageHistory.aggregate({
    where,
    _sum: { downloadBytes: true, uploadBytes: true },
  });
  const dl = agg._sum.downloadBytes ? Number(agg._sum.downloadBytes) : 0;
  const ul = agg._sum.uploadBytes ? Number(agg._sum.uploadBytes) : 0;
  return dl + ul;
}

async function last24hHourly(): Promise<{ hour: string; bytes: number }[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.nodeUsageHistory.groupBy({
    by: ['hour'],
    where: { hour: { gte: since } },
    _sum: { downloadBytes: true, uploadBytes: true },
    orderBy: { hour: 'asc' },
  });
  return rows.map((r) => ({
    hour: r.hour.toISOString(),
    bytes:
      (r._sum.downloadBytes ? Number(r._sum.downloadBytes) : 0) +
      (r._sum.uploadBytes ? Number(r._sum.uploadBytes) : 0),
  }));
}

async function userMetrics(): Promise<DashboardOverview['users']> {
  const now = new Date();
  const onlineCutoff = new Date(now.getTime() - ONLINE_NOW_WINDOW_MS);
  const todayCutoff = startOfToday();
  const weekCutoff = startOfWeek();

  const [statusGroups, onlineNow, onlineToday, onlineThisWeek, neverOnline, total] =
    await Promise.all([
      prisma.user.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      prisma.userTraffic.count({
        where: { user: { deletedAt: null }, onlineAt: { gte: onlineCutoff } },
      }),
      prisma.userTraffic.count({
        where: { user: { deletedAt: null }, onlineAt: { gte: todayCutoff } },
      }),
      prisma.userTraffic.count({
        where: { user: { deletedAt: null }, onlineAt: { gte: weekCutoff } },
      }),
      prisma.userTraffic.count({
        where: { user: { deletedAt: null }, onlineAt: null },
      }),
      prisma.user.count({ where: { deletedAt: null } }),
    ]);

  const byStatus: Record<string, number> = {};
  for (const g of statusGroups) {
    byStatus[g.status] = g._count._all;
  }

  return {
    total,
    byStatus,
    onlineNow,
    onlineToday,
    onlineThisWeek,
    neverOnline,
  };
}

async function trafficMetrics(): Promise<DashboardOverview['traffic']> {
  const today = startOfToday();
  const yesterday = startOfYesterday();
  const week = startOfWeek();
  const month = startOfMonth();
  const calMonth = startOfCalendarMonth();
  const year = startOfYear();

  const [todayBytes, yesterdayBytes, last7dBytes, last30dBytes, calendarMonthBytes, currentYearBytes, hourly] =
    await Promise.all([
      sumNodeUsageSince(today),
      sumNodeUsageSince(yesterday, today),
      sumNodeUsageSince(week),
      sumNodeUsageSince(month),
      sumNodeUsageSince(calMonth),
      sumNodeUsageSince(year),
      last24hHourly(),
    ]);

  return {
    todayBytes,
    yesterdayBytes,
    last7dBytes,
    last30dBytes,
    calendarMonthBytes,
    currentYearBytes,
    last24hHourly: hourly,
  };
}

async function nodeMetrics(): Promise<{
  nodes: DashboardOverview['nodes'];
  system: DashboardOverview['system'];
}> {
  const today = startOfToday();
  const nodes = await prisma.node.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      address: true,
      protocol: true,
      status: true,
      countryCode: true,
      lastStatusChange: true,
      _count: { select: { inbounds: true } },
    },
    orderBy: { name: 'asc' },
  });

  const todayUsage = await prisma.nodeUsageHistory.groupBy({
    by: ['nodeId'],
    where: { hour: { gte: today } },
    _sum: { downloadBytes: true, uploadBytes: true },
  });
  const todayByNode = new Map<string, number>();
  for (const r of todayUsage) {
    todayByNode.set(
      r.nodeId,
      (r._sum.downloadBytes ? Number(r._sum.downloadBytes) : 0) +
        (r._sum.uploadBytes ? Number(r._sum.uploadBytes) : 0),
    );
  }

  const metricsByNode = await Promise.all(
    nodes.map((n) => readCachedNodeMetrics(n.id)),
  );

  let onlineNodeCount = 0;
  const nodeRows: DashboardOverview['nodes'] = nodes.map((n, i) => {
    if (n.status === 'online') onlineNodeCount += 1;
    return {
      id: n.id,
      name: n.name,
      address: n.address,
      protocol: n.protocol,
      status: n.status,
      countryCode: n.countryCode,
      lastStatusChange: n.lastStatusChange ? n.lastStatusChange.toISOString() : null,
      inboundCount: n._count.inbounds,
      todayBytes: todayByNode.get(n.id) ?? 0,
      metrics: metricsByNode[i],
    };
  });

  return {
    nodes: nodeRows,
    system: {
      onlineNodeCount,
      totalNodeCount: nodes.length,
    },
  };
}

async function protocolMetrics(): Promise<DashboardOverview['byProtocol']> {
  const inboundCounts = await prisma.inbound.groupBy({
    by: ['protocol'],
    _count: { _all: true },
  });

  // Per-protocol enabled-user count requires raw SQL because enabledProtocols
  // is a JSON column; do a plain ANY() check via $queryRaw.
  const userByProto = await prisma.$queryRaw<{ protocol: string; count: bigint }[]>`
    SELECT
      jsonb_array_elements_text(enabled_protocols) AS protocol,
      COUNT(*)::bigint AS count
    FROM users
    WHERE deleted_at IS NULL
    GROUP BY protocol
  `;
  const userMap = new Map<string, number>();
  for (const r of userByProto) userMap.set(r.protocol, Number(r.count));

  const protocols = new Set<string>();
  for (const r of inboundCounts) protocols.add(r.protocol);
  for (const r of userByProto) protocols.add(r.protocol);

  return Array.from(protocols)
    .sort()
    .map((protocol) => ({
      protocol,
      inboundCount: inboundCounts.find((r) => r.protocol === protocol)?._count._all ?? 0,
      enabledUserCount: userMap.get(protocol) ?? 0,
    }));
}

async function topUsersToday(): Promise<DashboardOverview['topUsersToday']> {
  const today = startOfToday();
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const usage = await prisma.nodeUserUsageHistory.groupBy({
    by: ['userId'],
    where: { date: todayDate },
    _sum: { bytesIn: true, bytesOut: true },
    orderBy: { _sum: { bytesIn: 'desc' } },
    take: TOP_USERS_LIMIT,
  });

  if (usage.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: usage.map((u) => u.userId) } },
    select: { id: true, username: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.username]));

  return usage.map((u) => ({
    id: u.userId,
    username: nameById.get(u.userId) ?? '(deleted)',
    bytes:
      (u._sum.bytesIn ? Number(u._sum.bytesIn) : 0) +
      (u._sum.bytesOut ? Number(u._sum.bytesOut) : 0),
  }));
}

async function recentEvents(): Promise<DashboardOverview['recentEvents']> {
  const events = await prisma.subscriptionEvent.findMany({
    take: RECENT_EVENTS_LIMIT,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      eventType: true,
      userId: true,
      createdAt: true,
      user: { select: { username: true } },
    },
  });
  return events.map((e) => ({
    id: e.id.toString(),
    eventType: e.eventType,
    userId: e.userId,
    username: e.user?.username ?? null,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function getOverview(): Promise<DashboardOverview> {
  const [users, traffic, nodesAndSystem, byProtocol, topUsers, events, host] =
    await Promise.all([
      userMetrics(),
      trafficMetrics(),
      nodeMetrics(),
      protocolMetrics(),
      topUsersToday(),
      recentEvents(),
      collectSystemMetrics(),
    ]);

  return {
    users,
    traffic,
    system: nodesAndSystem.system,
    host,
    nodes: nodesAndSystem.nodes,
    byProtocol,
    topUsersToday: topUsers,
    recentEvents: events,
  };
}
