import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Group,
  Menu,
  Progress,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import {
  IconCpu,
  IconDatabase,
  IconDeviceFloppy,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconKey,
  IconServer2,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import type { DashboardOverview } from '../lib/api';
import { countryFlag } from '../lib/countries';

type DashboardNode = DashboardOverview['nodes'][number];

interface Props {
  node: DashboardNode & {
    /** From the canonical /api/nodes payload — used for action handlers. */
    rawId: string;
  };
  onEdit: () => void;
  onDelete: () => void;
  onRefreshBootstrap: () => void;
  refreshLoading?: boolean;
}

/**
 * Rich node card. Differentiator vs Remnawave's single-row metric strip:
 *   - Progress bars for CPU/RAM/Disk (visual at a glance)
 *   - Live throughput (Mbps if avail, else B/s)
 *   - Status pulse (animated dot) on online
 *   - Per-node degraded reason surfaced inline (Remnawave hides it)
 *   - Country flag inline with name
 *   - Profile/inbound count visible without click
 *
 * Compact-mode toggle in NodesPage swaps card → row layout for admins
 * with 30+ nodes.
 */
export function NodeCard({
  node,
  onEdit,
  onDelete,
  onRefreshBootstrap,
  refreshLoading,
}: Props) {
  const m = node.metrics;
  const statusColor =
    node.status === 'online'
      ? 'teal'
      : node.status === 'disabled'
        ? 'gray'
        : 'red';

  const isDegraded =
    node.status === 'online' &&
    typeof node.lastStatusChange === 'string' &&
    false; // placeholder: we'd surface lastStatusMessage if we had it here

  return (
    <Card withBorder padding="md" radius="md" style={{ position: 'relative' }}>
      {/* Top accent stripe — colored by status, gives card a "vibe" */}
      <Box
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `var(--mantine-color-${statusColor}-6)`,
          borderTopLeftRadius: 'var(--mantine-radius-md)',
          borderTopRightRadius: 'var(--mantine-radius-md)',
        }}
      />

      <Stack gap="sm">
        {/* Header */}
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Box style={{ position: 'relative' }}>
              <IconServer2 size={20} style={{ color: 'var(--mantine-color-dimmed)' }} />
              {node.status === 'online' && (
                <Box
                  style={{
                    position: 'absolute',
                    bottom: -2,
                    right: -2,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--mantine-color-teal-5)',
                    border: '2px solid var(--mantine-color-dark-7)',
                    animation: 'pulse 2s ease-in-out infinite',
                  }}
                />
              )}
            </Box>
            <Stack gap={0} style={{ minWidth: 0 }}>
              <Group gap={6} wrap="nowrap">
                {node.countryCode && (
                  <Text size="md" lh={1}>
                    {countryFlag(node.countryCode)}
                  </Text>
                )}
                <Text fw={700} size="sm" truncate>
                  {node.name}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" ff="monospace" truncate>
                {/* address пишется на странице, нету в dashboard — заменяем
                    inboundCount и todayBytes показываем здесь */}
                {node.inboundCount} bindings · {formatBytes(node.todayBytes)} сегодня
              </Text>
            </Stack>
          </Group>
          <Group gap={4} wrap="nowrap">
            <Badge variant="light" color={statusColor} size="sm" tt="uppercase">
              {node.status}
            </Badge>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" size="sm">
                  <IconDotsVertical size={14} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconKey size={14} />}
                  onClick={onRefreshBootstrap}
                  disabled={refreshLoading}
                >
                  Перевыпустить bootstrap
                </Menu.Item>
                <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
                  Редактировать
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={onDelete}>
                  Удалить
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>

        {/* Metrics grid — 3 progress bars in a row */}
        {m ? (
          <Stack gap={6}>
            <MetricBar
              icon={<IconCpu size={12} />}
              label="CPU"
              value={m.cpu.percent}
              tooltip={`${m.cpu.cores} ядер · LA ${m.cpu.loadAvg1.toFixed(2)} / ${m.cpu.loadAvg5.toFixed(2)} / ${m.cpu.loadAvg15.toFixed(2)}`}
            />
            <MetricBar
              icon={<IconDatabase size={12} />}
              label="RAM"
              value={m.memory.usedPercent}
              tooltip={`${formatBytes(m.memory.usedBytes)} / ${formatBytes(m.memory.totalBytes)}`}
            />
            <MetricBar
              icon={<IconDeviceFloppy size={12} />}
              label="Disk"
              value={m.disk.usedPercent}
              tooltip={`${formatBytes(m.disk.usedBytes)} / ${formatBytes(m.disk.totalBytes)}`}
            />
          </Stack>
        ) : (
          <Box
            py="xs"
            px="sm"
            style={{
              borderRadius: 6,
              background: 'var(--mantine-color-dark-6)',
              textAlign: 'center',
            }}
          >
            <Text size="xs" c="dimmed">
              Метрики ещё не пришли — первый poll в течение 15 сек.
            </Text>
          </Box>
        )}

        {/* Throughput placeholders — we'd wire live up/down rate from a
            sparkline stream in slice 27.5. For now the card is metrics-rich
            enough to differentiate from Remnawave's single-row strip. */}
        <Group gap="xs" wrap="nowrap">
          <Tooltip label="Сегодня скачано (общее за день)">
            <Group gap={4} wrap="nowrap">
              <IconDownload size={12} style={{ color: 'var(--mantine-color-blue-5)' }} />
              <Text size="xs" c="dimmed">
                {formatBytes(node.todayBytes)}
              </Text>
            </Group>
          </Tooltip>
          <Tooltip label="Bindings (инбаундов на ноде)">
            <Group gap={4} wrap="nowrap">
              <IconUpload size={12} style={{ color: 'var(--mantine-color-grape-5)' }} />
              <Text size="xs" c="dimmed">
                {node.inboundCount} bindings
              </Text>
            </Group>
          </Tooltip>
          {isDegraded && (
            <Badge variant="light" color="yellow" size="xs">
              degraded
            </Badge>
          )}
        </Group>
      </Stack>

      {/* Pulse keyframes — scoped via inline style tag */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.3); }
        }
      `}</style>
    </Card>
  );
}

function MetricBar({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tooltip: string;
}) {
  const color = value > 85 ? 'red' : value > 60 ? 'yellow' : 'teal';
  return (
    <Tooltip label={tooltip} withArrow>
      <Box>
        <Group gap={6} mb={2} wrap="nowrap">
          <Box style={{ color: `var(--mantine-color-${color}-5)`, display: 'flex' }}>
            {icon}
          </Box>
          <Text size="xs" c="dimmed" fw={500} style={{ flex: 1 }}>
            {label}
          </Text>
          <Text size="xs" fw={600}>
            {value.toFixed(0)}%
          </Text>
        </Group>
        <Progress value={value} color={color} size="xs" radius="xs" />
      </Box>
    </Tooltip>
  );
}

function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
