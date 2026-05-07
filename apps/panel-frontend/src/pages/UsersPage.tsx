import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { copyToClipboard } from '../lib/clipboard';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconCheck,
  IconCircleCheck,
  IconCircleMinus,
  IconCircleOff,
  IconClockHour4,
  IconCopy,
  IconEdit,
  IconExternalLink,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUserOff,
  IconUsers,
} from '@tabler/icons-react';
import {
  createUser,
  deleteUser,
  listSquads,
  listUsers,
  subscriptionUrl,
  updateUser,
  type CreateUserInput,
  type UpdateUserInput,
  type User,
} from '../lib/api';
import { UserFormModal } from '../components/UserFormModal';

// ───── Helpers ─────

const STATUS_COLORS: Record<string, string> = {
  active: 'teal',
  disabled: 'gray',
  expired: 'red',
  limited: 'yellow',
};

const PROTOCOL_COLORS: Record<string, string> = {
  hysteria: 'blue',
  xray: 'violet',
  amneziawg: 'teal',
  naive: 'orange',
  shadowsocks: 'pink',
  mtproto: 'cyan',
  mieru: 'grape',
};

const GiB = 1_073_741_824;

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

function trafficPercent(used: number, limit: number | null): number | null {
  if (limit === null || limit === 0) return null;
  return Math.min(100, (used / limit) * 100);
}

function relativeTime(iso: string | null): { text: string; tone: 'fresh' | 'stale' | 'never' } {
  if (!iso) return { text: 'никогда', tone: 'never' };
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  const tone: 'fresh' | 'stale' = sec < 5 * 60 ? 'fresh' : 'stale';
  if (sec < 60) return { text: `${sec}с назад`, tone };
  const min = Math.round(sec / 60);
  if (min < 60) return { text: `${min}м назад`, tone };
  const hr = Math.round(min / 60);
  if (hr < 24) return { text: `${hr}ч назад`, tone };
  const days = Math.round(hr / 24);
  return { text: `${days}д назад`, tone };
}

function expireRelative(iso: string | null): { text: string; tone: 'good' | 'warn' | 'bad' | 'never' } {
  if (!iso) return { text: 'без срока', tone: 'never' };
  const diffMs = new Date(iso).getTime() - Date.now();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return { text: `истёк ${-days}д назад`, tone: 'bad' };
  if (days === 0) return { text: 'истекает сегодня', tone: 'bad' };
  if (days <= 7) return { text: `${days}д осталось`, tone: 'warn' };
  return { text: `${days}д осталось`, tone: 'good' };
}

// ───── Subscription URL cell ─────

function SubscriptionCell({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await copyToClipboard(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      notifications.show({
        color: 'red',
        title: 'Copy failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <Group gap={2} wrap="nowrap">
      <Tooltip label={copied ? 'Скопировано' : 'Скопировать sub URL'}>
        <ActionIcon
          variant="subtle"
          color={copied ? 'teal' : 'gray'}
          onClick={handleCopy}
          aria-label="Copy subscription URL"
          size="sm"
        >
          {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Открыть подписку">
        <ActionIcon
          variant="subtle"
          color="gray"
          component="a"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open subscription URL"
          size="sm"
        >
          <IconExternalLink size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

// ───── Stats card ─────

interface StatChipProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  active?: boolean;
  onClick?: () => void;
}

function StatChip({ icon, label, value, color, active, onClick }: StatChipProps) {
  return (
    <Card
      withBorder
      padding="sm"
      radius="md"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        borderColor: active ? `var(--mantine-color-${color}-6)` : undefined,
        borderWidth: active ? 2 : 1,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={0}>
          <Text size="xs" c="dimmed" tt="uppercase" lts={0.6} fw={600}>
            {label}
          </Text>
          <Text size="xl" fw={700} lh={1.1}>
            {value}
          </Text>
        </Stack>
        <ThemeIcon size={36} radius="md" variant="light" color={color}>
          {icon}
        </ThemeIcon>
      </Group>
    </Card>
  );
}

// ───── Main page ─────

type StatusFilter = 'all' | 'active' | 'expired' | 'limited' | 'disabled';

export function UsersPage() {
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers({ page: 1, limit: 200 }),
  });
  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });
  const squadNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of squadsQuery.data?.squads ?? []) m.set(s.id, s.name);
    return m;
  }, [squadsQuery.data]);

  const allUsers = usersQuery.data?.users ?? [];

  const stats = useMemo(() => {
    const s = { total: allUsers.length, active: 0, expired: 0, limited: 0, disabled: 0 };
    for (const u of allUsers) {
      if (u.status === 'active') s.active++;
      else if (u.status === 'expired') s.expired++;
      else if (u.status === 'limited') s.limited++;
      else if (u.status === 'disabled') s.disabled++;
    }
    return s;
  }, [allUsers]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUsers.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.shortId.toLowerCase().includes(q) ||
        (u.tag?.toLowerCase().includes(q) ?? false) ||
        (u.email?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [allUsers, search, statusFilter]);

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: 'User created' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) => updateUser(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: 'User updated' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: 'User deleted' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(user: User) {
    modals.openConfirmModal({
      title: `Delete user "${user.username}"?`,
      children: (
        <Text size="sm">
          The user will be soft-deleted and removed from all nodes. This cannot be undone from the UI.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(user.id),
    });
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>Пользователи</Title>
          <Text c="dimmed" size="sm">
            {stats.total} всего
            {filteredUsers.length !== stats.total && ` · ${filteredUsers.length} в выборке`}
          </Text>
        </Stack>
        <Group>
          <Tooltip label="Обновить">
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={() => qc.invalidateQueries({ queryKey: ['users'] })}
              loading={usersQuery.isFetching}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Создать
          </Button>
        </Group>
      </Group>

      {/* Stats row — clickable as filters */}
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
        <StatChip
          icon={<IconUsers size={20} />}
          label="Всего"
          value={stats.total}
          color="blue"
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <StatChip
          icon={<IconCircleCheck size={20} />}
          label="Active"
          value={stats.active}
          color="teal"
          active={statusFilter === 'active'}
          onClick={() => setStatusFilter('active')}
        />
        <StatChip
          icon={<IconClockHour4 size={20} />}
          label="Expired"
          value={stats.expired}
          color="red"
          active={statusFilter === 'expired'}
          onClick={() => setStatusFilter('expired')}
        />
        <StatChip
          icon={<IconCircleMinus size={20} />}
          label="Limited"
          value={stats.limited}
          color="yellow"
          active={statusFilter === 'limited'}
          onClick={() => setStatusFilter('limited')}
        />
        <StatChip
          icon={<IconCircleOff size={20} />}
          label="Disabled"
          value={stats.disabled}
          color="gray"
          active={statusFilter === 'disabled'}
          onClick={() => setStatusFilter('disabled')}
        />
      </SimpleGrid>

      {/* Search + filters */}
      <Group gap="sm" wrap="nowrap">
        <TextInput
          placeholder="Поиск по username / shortId / tag / email…"
          leftSection={<IconSearch size={16} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1 }}
        />
        <SegmentedControl
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          data={[
            { value: 'all', label: 'Все' },
            { value: 'active', label: 'Active' },
            { value: 'expired', label: 'Expired' },
            { value: 'limited', label: 'Limited' },
            { value: 'disabled', label: 'Off' },
          ]}
          size="sm"
          visibleFrom="md"
        />
      </Group>

      {/* Table */}
      <Card withBorder padding={0} radius="md">
        <Table.ScrollContainer minWidth={1100}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Пользователь</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Последнее подключение</Table.Th>
                <Table.Th>Истекает</Table.Th>
                <Table.Th>Расход трафика</Table.Th>
                <Table.Th>Сквады</Table.Th>
                <Table.Th>Протоколы</Table.Th>
                <Table.Th>Tag</Table.Th>
                <Table.Th style={{ width: 1 }}>Действия</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredUsers.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={9}>
                    <Stack align="center" py="xl" gap="xs">
                      <ThemeIcon size={40} radius="md" variant="light" color="gray">
                        <IconUserOff size={22} />
                      </ThemeIcon>
                      <Text c="dimmed" size="sm">
                        {allUsers.length === 0
                          ? 'Пользователей пока нет — нажми «Создать».'
                          : 'Ничего не найдено по текущему фильтру.'}
                      </Text>
                    </Stack>
                  </Table.Td>
                </Table.Tr>
              )}
              {filteredUsers.map((u) => {
                const last = relativeTime(u.lastOnlineAt);
                const exp = expireRelative(u.expireAt);
                const trafficPct = trafficPercent(u.trafficUsedBytes, u.trafficLimitBytes);
                const trafficColor =
                  trafficPct === null
                    ? 'teal'
                    : trafficPct >= 90
                      ? 'red'
                      : trafficPct >= 70
                        ? 'yellow'
                        : 'teal';
                const otherSquads = u.groupIds.filter(
                  (id) => id !== '00000000-0000-0000-0000-000000000001',
                );

                return (
                  <Table.Tr key={u.id}>
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <StatusDot status={u.status} />
                        <Stack gap={0}>
                          <Text size="sm" fw={600}>
                            {u.username}
                          </Text>
                          <Text size="xs" c="dimmed" ff="monospace">
                            {u.shortId}
                          </Text>
                        </Stack>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={STATUS_COLORS[u.status] ?? 'gray'}
                        tt="uppercase"
                      >
                        {u.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip
                        label={u.lastOnlineAt ? new Date(u.lastOnlineAt).toLocaleString() : '—'}
                      >
                        <Text
                          size="sm"
                          c={
                            last.tone === 'fresh'
                              ? 'teal'
                              : last.tone === 'never'
                                ? 'dimmed'
                                : undefined
                          }
                        >
                          {last.text}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={u.expireAt ? new Date(u.expireAt).toLocaleString() : '—'}>
                        <Text
                          size="sm"
                          c={
                            exp.tone === 'bad'
                              ? 'red'
                              : exp.tone === 'warn'
                                ? 'yellow'
                                : exp.tone === 'never'
                                  ? 'dimmed'
                                  : undefined
                          }
                        >
                          {exp.text}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td miw={200}>
                      <Stack gap={4}>
                        <Group justify="space-between" gap="xs">
                          <Text size="xs" ff="monospace">
                            {formatBytes(u.trafficUsedBytes)}{' '}
                            <Text span c="dimmed">
                              /{' '}
                              {u.trafficLimitBytes === null
                                ? '∞'
                                : formatBytes(u.trafficLimitBytes)}
                            </Text>
                          </Text>
                          {trafficPct !== null && (
                            <Text size="xs" c={trafficColor} ff="monospace" fw={600}>
                              {trafficPct.toFixed(0)}%
                            </Text>
                          )}
                        </Group>
                        <Progress
                          value={trafficPct ?? 0}
                          color={trafficColor}
                          size="sm"
                          radius="xl"
                        />
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      {otherSquads.length === 0 ? (
                        <Badge variant="default" color="gray" size="sm">
                          All
                        </Badge>
                      ) : (
                        <Group gap={4}>
                          {otherSquads.slice(0, 2).map((id) => (
                            <Badge key={id} variant="light" color="indigo" size="sm">
                              {squadNameById.get(id) ?? id.slice(0, 6)}
                            </Badge>
                          ))}
                          {otherSquads.length > 2 && (
                            <Badge variant="default" color="gray" size="sm">
                              +{otherSquads.length - 2}
                            </Badge>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="wrap">
                        {u.enabledProtocols.map((p) => (
                          <Badge
                            key={p}
                            color={PROTOCOL_COLORS[p] ?? 'gray'}
                            variant="light"
                            size="sm"
                          >
                            {p}
                          </Badge>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {u.tag ? (
                        <Badge variant="outline" color="gray" size="sm">
                          {u.tag}
                        </Badge>
                      ) : (
                        <Text c="dimmed" size="xs">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} wrap="nowrap">
                        <SubscriptionCell url={subscriptionUrl(u.subscriptionToken)} />
                        <Tooltip label="Редактировать">
                          <ActionIcon variant="subtle" onClick={() => setEditing(u)} size="sm">
                            <IconEdit size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="Удалить">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() => handleDelete(u)}
                            size="sm"
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <UserFormModal
        opened={createOpen}
        onClose={closeCreate}
        user={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateUserInput);
        }}
      />

      <UserFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        user={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input: input as UpdateUserInput });
        }}
      />
    </Stack>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'gray';
  return (
    <Paper
      w={10}
      h={10}
      radius={999}
      bg={`var(--mantine-color-${color}-6)`}
      style={{ flexShrink: 0 }}
    />
  );
}
