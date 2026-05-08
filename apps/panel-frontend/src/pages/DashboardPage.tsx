import type { ReactNode } from 'react';
import {
  Badge,
  Card,
  Group,
  Paper,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  IconActivity,
  IconArrowDownRight,
  IconArrowUpRight,
  IconCalendar,
  IconChartArea,
  IconClock,
  IconCpu,
  IconDatabase,
  IconDeviceDesktopAnalytics,
  IconNetwork,
  IconServer2,
  IconTrendingUp,
  IconUserCheck,
  IconUsers,
  IconWifi,
} from '@tabler/icons-react';
import { getDashboardOverview, type DashboardOverview } from '../lib/api';

const NODE_STATUS_COLOR: Record<string, string> = {
  online: 'teal',
  offline: 'red',
  unreachable: 'red',
  unknown: 'gray',
  disabled: 'gray',
};

const EVENT_COLOR: Record<string, string> = {
  'user.created': 'teal',
  'user.updated': 'blue',
  'user.deleted': 'red',
  'user.status-changed': 'yellow',
};

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

function formatDelta(value: number, base: number): { text: string; positive: boolean } {
  if (base === 0) return { text: formatBytes(value), positive: value >= 0 };
  const delta = value - base;
  const sign = delta >= 0 ? '+' : '−';
  return { text: `${sign}${formatBytes(Math.abs(delta))}`, positive: delta >= 0 };
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  hintColor?: 'teal' | 'red' | 'gray';
  iconColor: string;
}

function StatCard({ icon, label, value, hint, hintColor = 'gray', iconColor }: StatCardProps) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} lts={0.6}>
            {label}
          </Text>
          <Text size="xl" fw={700} lh={1.1}>
            {value}
          </Text>
          {hint && (
            <Text size="xs" c={hintColor}>
              {hint}
            </Text>
          )}
        </Stack>
        <ThemeIcon size={42} radius="md" variant="light" color={iconColor}>
          {icon}
        </ThemeIcon>
      </Group>
    </Card>
  );
}

function Sparkline({ data, height = 110 }: { data: { hour: string; bytes: number }[]; height?: number }) {
  if (data.length < 2) {
    return (
      <Group justify="center" h={height}>
        <Text c="dimmed" size="sm">
          Недостаточно данных для графика — соберём после первого часа трафика
        </Text>
      </Group>
    );
  }
  const max = Math.max(...data.map((d) => d.bytes), 1);
  const w = 800;
  const h = height;
  const stepX = w / (data.length - 1);
  const pts = data.map((d, i) => `${(i * stepX).toFixed(1)},${(h - (d.bytes / max) * (h - 8) - 4).toFixed(1)}`);
  const line = `M ${pts.join(' L ')}`;
  const area = `${line} L ${w},${h} L 0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--mantine-color-teal-5)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--mantine-color-teal-5)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkGrad)" />
      <path d={line} fill="none" stroke="var(--mantine-color-teal-4)" strokeWidth={2} />
    </svg>
  );
}

export function DashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: getDashboardOverview,
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <Stack>
        <Title order={2}>Главная</Title>
        <Text c="dimmed">Загрузка…</Text>
      </Stack>
    );
  }
  if (isError || !data) {
    return (
      <Stack>
        <Title order={2}>Главная</Title>
        <Text c="red">Не удалось загрузить overview. Проверь backend.</Text>
      </Stack>
    );
  }

  return <DashboardContent data={data} />;
}

function DashboardContent({ data }: { data: DashboardOverview }) {
  const { users, traffic, system, nodes, byProtocol, topUsersToday, recentEvents } = data;
  const todayDelta = formatDelta(traffic.todayBytes, traffic.yesterdayBytes);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>Главная</Title>
          <Text c="dimmed" size="sm">
            Сводка по панели — обновляется каждые 10 секунд
          </Text>
        </Stack>
      </Group>

      {/* Hero row */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <StatCard
          icon={<IconWifi size={22} />}
          iconColor="teal"
          label="В сети сейчас"
          value={`${users.onlineNow}`}
          hint={`${users.onlineToday} за сегодня · ${users.onlineThisWeek} за неделю`}
        />
        <StatCard
          icon={<IconChartArea size={22} />}
          iconColor="cyan"
          label="Трафик сегодня"
          value={formatBytes(traffic.todayBytes)}
          hint={`${todayDelta.text} ко вчерашнему`}
          hintColor={todayDelta.positive ? 'teal' : 'red'}
        />
        <StatCard
          icon={<IconUserCheck size={22} />}
          iconColor="violet"
          label="Активных пользователей"
          value={`${users.byStatus.active ?? 0}`}
          hint={`из ${users.total} всего`}
        />
        <StatCard
          icon={<IconServer2 size={22} />}
          iconColor="indigo"
          label="Ноды онлайн"
          value={`${system.onlineNodeCount} / ${system.totalNodeCount}`}
          hint={system.onlineNodeCount === system.totalNodeCount ? 'Все ноды отвечают' : 'Часть нод недоступна'}
          hintColor={system.onlineNodeCount === system.totalNodeCount ? 'teal' : 'red'}
        />
      </SimpleGrid>

      {/* Traffic sparkline */}
      <Card withBorder padding="lg" radius="md">
        <Group justify="space-between" mb="xs">
          <Group gap="xs">
            <ThemeIcon size={28} radius="md" variant="light" color="teal">
              <IconTrendingUp size={16} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={600}>Трафик за 24 часа</Text>
              <Text size="xs" c="dimmed">
                Сумма по всем нодам, по часам
              </Text>
            </Stack>
          </Group>
          <Group gap="lg">
            <TrafficStat label="Сегодня" value={formatBytes(traffic.todayBytes)} />
            <TrafficStat label="Неделя" value={formatBytes(traffic.last7dBytes)} />
            <TrafficStat label="30 дней" value={formatBytes(traffic.last30dBytes)} />
            <TrafficStat label="Месяц" value={formatBytes(traffic.calendarMonthBytes)} />
            <TrafficStat label="Год" value={formatBytes(traffic.currentYearBytes)} />
          </Group>
        </Group>
        <Sparkline data={traffic.last24hHourly} />
      </Card>

      {/* User status breakdown */}
      <Card withBorder padding="lg" radius="md">
        <Group gap="xs" mb="md">
          <ThemeIcon size={28} radius="md" variant="light" color="violet">
            <IconUsers size={16} />
          </ThemeIcon>
          <Text fw={600}>Пользователи по статусу</Text>
        </Group>
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
          <StatusChip label="Всего" value={users.total} color="blue" />
          <StatusChip label="Active" value={users.byStatus.active ?? 0} color="teal" />
          <StatusChip label="Expired" value={users.byStatus.expired ?? 0} color="red" />
          <StatusChip label="Limited" value={users.byStatus.limited ?? 0} color="yellow" />
          <StatusChip label="Disabled" value={users.byStatus.disabled ?? 0} color="gray" />
        </SimpleGrid>
      </Card>

      {/* Host system metrics */}
      <SystemHealth host={data.host} />

      {/* Two-column row: nodes + protocols */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder padding="lg" radius="md">
          <Group gap="xs" mb="md">
            <ThemeIcon size={28} radius="md" variant="light" color="indigo">
              <IconServer2 size={16} />
            </ThemeIcon>
            <Text fw={600}>Ноды</Text>
            <Badge variant="light" color="gray">
              {nodes.length}
            </Badge>
          </Group>
          {nodes.length === 0 ? (
            <Text c="dimmed" size="sm">
              Нод ещё нет — добавь первую в разделе Nodes.
            </Text>
          ) : (
            <ScrollArea.Autosize mah={320}>
              <Table verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Имя</Table.Th>
                    <Table.Th>Статус</Table.Th>
                    <Table.Th>CPU</Table.Th>
                    <Table.Th>RAM</Table.Th>
                    <Table.Th>Диск</Table.Th>
                    <Table.Th ta="right">Профили</Table.Th>
                    <Table.Th ta="right">Сегодня</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {nodes.map((n) => (
                    <Table.Tr key={n.id}>
                      <Table.Td>
                        <Stack gap={0}>
                          <Text size="sm" fw={500}>
                            {n.countryCode ? `${flagEmoji(n.countryCode)} ` : ''}
                            {n.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {n.address}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <Tooltip
                          label={
                            n.lastStatusChange
                              ? `Сменился ${relativeTime(n.lastStatusChange)}`
                              : 'Нет данных о статусе'
                          }
                        >
                          <Badge color={NODE_STATUS_COLOR[n.status] ?? 'gray'} variant="light">
                            {n.status}
                          </Badge>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        <NodeMiniBar
                          percent={n.metrics?.cpu.usagePercent ?? null}
                          tooltip={
                            n.metrics
                              ? `${n.metrics.cpu.cores} ядер · LA ${n.metrics.cpu.loadAvg1.toFixed(2)}/${n.metrics.cpu.loadAvg5.toFixed(2)}/${n.metrics.cpu.loadAvg15.toFixed(2)}`
                              : 'Метрики не доступны'
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        <NodeMiniBar
                          percent={n.metrics?.memory.usedPercent ?? null}
                          tooltip={
                            n.metrics
                              ? `${formatBytes(n.metrics.memory.usedBytes)} / ${formatBytes(n.metrics.memory.totalBytes)}`
                              : 'Метрики не доступны'
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        <NodeMiniBar
                          percent={n.metrics?.disk.usedPercent ?? null}
                          tooltip={
                            n.metrics
                              ? `${formatBytes(n.metrics.disk.usedBytes)} / ${formatBytes(n.metrics.disk.totalBytes)}`
                              : 'Метрики не доступны'
                          }
                        />
                      </Table.Td>
                      <Table.Td ta="right">{n.inboundCount}</Table.Td>
                      <Table.Td ta="right">{formatBytes(n.todayBytes)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          )}
        </Card>

        <Card withBorder padding="lg" radius="md">
          <Group gap="xs" mb="md">
            <ThemeIcon size={28} radius="md" variant="light" color="cyan">
              <IconNetwork size={16} />
            </ThemeIcon>
            <Text fw={600}>Протоколы</Text>
            <Badge variant="light" color="gray">
              {byProtocol.length}
            </Badge>
          </Group>
          {byProtocol.length === 0 ? (
            <Text c="dimmed" size="sm">
              Профилей пока нет.
            </Text>
          ) : (
            <Stack gap="xs">
              {byProtocol.map((p) => (
                <Paper key={p.protocol} withBorder p="sm" radius="sm">
                  <Group justify="space-between">
                    <Group gap="sm">
                      <Badge variant="light" color="cyan">
                        {p.protocol}
                      </Badge>
                      <Text size="sm" c="dimmed">
                        {p.inboundCount} {p.inboundCount === 1 ? 'профиль' : 'профилей'}
                      </Text>
                    </Group>
                    <Group gap={4}>
                      <Text size="sm" fw={600}>
                        {p.enabledUserCount}
                      </Text>
                      <Text size="xs" c="dimmed">
                        пользователей
                      </Text>
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </Card>
      </SimpleGrid>

      {/* Two-column row: top users + recent events */}
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder padding="lg" radius="md">
          <Group gap="xs" mb="md">
            <ThemeIcon size={28} radius="md" variant="light" color="orange">
              <IconActivity size={16} />
            </ThemeIcon>
            <Text fw={600}>Топ-5 пользователей сегодня</Text>
          </Group>
          {topUsersToday.length === 0 ? (
            <Text c="dimmed" size="sm">
              Сегодня ещё никто не накачал трафика.
            </Text>
          ) : (
            <Stack gap="xs">
              {topUsersToday.map((u, i) => (
                <Group key={u.id} justify="space-between">
                  <Group gap="sm">
                    <ThemeIcon size={24} radius="xl" variant="light" color={i === 0 ? 'yellow' : 'gray'}>
                      <Text size="xs" fw={700}>
                        {i + 1}
                      </Text>
                    </ThemeIcon>
                    <Text size="sm">{u.username}</Text>
                  </Group>
                  <Text size="sm" fw={600} ff="monospace">
                    {formatBytes(u.bytes)}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </Card>

        <Card withBorder padding="lg" radius="md">
          <Group gap="xs" mb="md">
            <ThemeIcon size={28} radius="md" variant="light" color="grape">
              <IconClock size={16} />
            </ThemeIcon>
            <Text fw={600}>Последние события</Text>
          </Group>
          {recentEvents.length === 0 ? (
            <Text c="dimmed" size="sm">
              Журнал событий пуст.
            </Text>
          ) : (
            <Stack gap="xs">
              {recentEvents.map((e) => {
                const isCreate = e.eventType === 'user.created';
                const Icon = isCreate ? IconArrowUpRight : IconArrowDownRight;
                return (
                  <Group key={e.id} justify="space-between" wrap="nowrap">
                    <Group gap="xs" wrap="nowrap">
                      <ThemeIcon
                        size={22}
                        radius="xl"
                        variant="light"
                        color={EVENT_COLOR[e.eventType] ?? 'gray'}
                      >
                        <Icon size={12} />
                      </ThemeIcon>
                      <Stack gap={0}>
                        <Text size="sm">{e.eventType}</Text>
                        <Text size="xs" c="dimmed">
                          {e.username ?? e.userId.slice(0, 8)}
                        </Text>
                      </Stack>
                    </Group>
                    <Tooltip label={new Date(e.createdAt).toLocaleString()}>
                      <Text size="xs" c="dimmed">
                        {relativeTime(e.createdAt)}
                      </Text>
                    </Tooltip>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Card>
      </SimpleGrid>

      {/* Footer summary */}
      <Group justify="space-between" gap="xs">
        <Group gap="xs">
          <IconCalendar size={14} stroke={1.5} color="var(--mantine-color-dimmed)" />
          <Text size="xs" c="dimmed">
            Никогда не подключался: {users.neverOnline}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {new Date().toLocaleString()}
        </Text>
      </Group>
    </Stack>
  );
}

function SystemHealth({ host }: { host: DashboardOverview['host'] }) {
  const cpuPct = host.cpu.samplePercent;
  const cpuColor = cpuPct > 85 ? 'red' : cpuPct > 60 ? 'yellow' : 'teal';
  const memColor =
    host.memory.usedPercent > 90 ? 'red' : host.memory.usedPercent > 75 ? 'yellow' : 'teal';
  const diskColor = host.disk
    ? host.disk.usedPercent > 90
      ? 'red'
      : host.disk.usedPercent > 80
        ? 'yellow'
        : 'teal'
    : 'gray';

  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="xs" mb="md">
        <ThemeIcon size={28} radius="md" variant="light" color="blue">
          <IconDeviceDesktopAnalytics size={16} />
        </ThemeIcon>
        <Stack gap={0}>
          <Text fw={600}>Состояние панели</Text>
          <Text size="xs" c="dimmed">
            Хост, на котором работает API · uptime {formatUptime(host.process.uptimeSeconds)}
          </Text>
        </Stack>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <UsageBar
          icon={<IconCpu size={18} />}
          color={cpuColor}
          label="CPU"
          percent={cpuPct}
          primary={`${cpuPct.toFixed(1)}%`}
          secondary={`${host.cpu.cores} ядер · LA ${host.cpu.loadavg[0].toFixed(2)} / ${host.cpu.loadavg[1].toFixed(2)} / ${host.cpu.loadavg[2].toFixed(2)}`}
        />
        <UsageBar
          icon={<IconDatabase size={18} />}
          color={memColor}
          label="RAM"
          percent={host.memory.usedPercent}
          primary={`${formatBytes(host.memory.usedBytes)} / ${formatBytes(host.memory.totalBytes)}`}
          secondary={`${host.memory.usedPercent.toFixed(1)}% занято`}
        />
        <UsageBar
          icon={<IconServer2 size={18} />}
          color={diskColor}
          label="Диск"
          percent={host.disk?.usedPercent ?? 0}
          primary={
            host.disk
              ? `${formatBytes(host.disk.usedBytes)} / ${formatBytes(host.disk.totalBytes)}`
              : '—'
          }
          secondary={
            host.disk
              ? `${host.disk.usedPercent.toFixed(1)}% занято`
              : 'statfs недоступен'
          }
        />
        <UsageBar
          icon={<IconActivity size={18} />}
          color="violet"
          label="Процесс панели"
          percent={(host.process.heapUsedBytes / Math.max(1, host.process.heapTotalBytes)) * 100}
          primary={`RSS ${formatBytes(host.process.rssBytes)}`}
          secondary={`Heap ${formatBytes(host.process.heapUsedBytes)} / ${formatBytes(host.process.heapTotalBytes)}`}
        />
      </SimpleGrid>
    </Card>
  );
}

function UsageBar({
  icon,
  label,
  percent,
  primary,
  secondary,
  color,
}: {
  icon: ReactNode;
  label: string;
  percent: number;
  primary: string;
  secondary: string;
  color: string;
}) {
  return (
    <Paper withBorder p="md" radius="sm">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <ThemeIcon size={22} radius="md" variant="light" color={color}>
            {icon}
          </ThemeIcon>
          <Text size="sm" fw={500}>
            {label}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" ff="monospace">
          {percent.toFixed(0)}%
        </Text>
      </Group>
      <Progress value={Math.min(100, Math.max(0, percent))} color={color} size="sm" radius="xl" />
      <Stack gap={0} mt="xs">
        <Text size="sm" fw={600} ff="monospace">
          {primary}
        </Text>
        <Text size="xs" c="dimmed">
          {secondary}
        </Text>
      </Stack>
    </Paper>
  );
}

function formatUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function NodeMiniBar({
  percent,
  tooltip,
}: {
  percent: number | null;
  tooltip: string;
}) {
  if (percent === null) {
    return (
      <Text size="xs" c="dimmed">
        —
      </Text>
    );
  }
  const color = percent > 90 ? 'red' : percent > 75 ? 'yellow' : 'teal';
  return (
    <Tooltip label={tooltip}>
      <Stack gap={2} miw={90}>
        <Progress value={Math.min(100, percent)} color={color} size="sm" radius="xl" />
        <Text size="xs" c="dimmed" ff="monospace">
          {percent.toFixed(0)}%
        </Text>
      </Stack>
    </Tooltip>
  );
}

function TrafficStat({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={0} align="flex-end">
      <Text size="xs" c="dimmed" tt="uppercase" lts={0.5}>
        {label}
      </Text>
      <Text size="sm" fw={600} ff="monospace">
        {value}
      </Text>
    </Stack>
  );
}

function StatusChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Paper withBorder p="sm" radius="sm">
      <Stack gap={2}>
        <Text size="xs" c="dimmed" tt="uppercase" lts={0.5}>
          {label}
        </Text>
        <Group justify="space-between" align="baseline">
          <Text size="xl" fw={700}>
            {value}
          </Text>
          <Badge variant="light" color={color} size="xs">
            ●
          </Badge>
        </Group>
      </Stack>
    </Paper>
  );
}

function flagEmoji(cc: string): string {
  if (cc.length !== 2) return '';
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(A + (cc.toUpperCase().charCodeAt(0) - a)) +
    String.fromCodePoint(A + (cc.toUpperCase().charCodeAt(1) - a));
}
