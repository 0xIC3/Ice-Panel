import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
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
import { PageHero } from '../components/PageHero';

// ───── Helpers ─────

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const GROUND = '#08101A';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const MOSS = '#A7D8B9';
const AMBER = '#F5B14C';
const RED = '#E07A5F';
const VIOLET = '#A78BFA';

const DISPLAY = { fontFamily: "'Space Grotesk', Inter, sans-serif" };
const MONO = { fontFamily: "'JetBrains Mono', monospace" };
const MONO_LABEL = {
  ...MONO,
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  color: MIST,
};

const STATUS_ACCENT: Record<string, string> = {
  active: MOSS,
  disabled: MIST,
  expired: RED,
  limited: AMBER,
};

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
  const { t } = useTranslation();
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
      <Tooltip label={copied ? t('common.copied') : t('common.copy')}>
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
      <Tooltip label={t('users.table.subscription')}>
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
  accent: string;
  active?: boolean;
  onClick?: () => void;
}

function StatChip({ icon, label, value, accent, active, onClick }: StatChipProps) {
  return (
    <Card
      withBorder
      padding="sm"
      radius="md"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        backgroundColor: CARD,
        borderColor: active ? accent : HAIRLINE,
        borderWidth: active ? 2 : 1,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={2}>
          <Text style={MONO_LABEL}>{label}</Text>
          <Text style={{ ...DISPLAY, fontSize: 28, fontWeight: 500, lineHeight: 1, color: SNOW }}>
            {value}
          </Text>
        </Stack>
        <ThemeIcon
          size={36}
          radius="md"
          variant="light"
          style={{
            backgroundColor: `${accent}1A`,
            color: accent,
            border: `1px solid ${accent}33`,
          }}
        >
          {icon}
        </ThemeIcon>
      </Group>
    </Card>
  );
}

// ───── Main page ─────

type StatusFilter = 'all' | 'active' | 'expired' | 'limited' | 'disabled';

export function UsersPage() {
  const { t } = useTranslation();
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
      notifications.show({ color: 'green', message: t('users.notify.created') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) => updateUser(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.updated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: t('users.notify.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(user: User) {
    modals.openConfirmModal({
      title: t('users.deleteTitle', { name: user.username }),
      children: (
        <Text size="sm">
          {t('users.deleteBody')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(user.id),
    });
  }

  return (
    <Stack gap="lg">
      <PageHero
        eyebrow={`${stats.total} ACCOUNTS · ${stats.active} ONLINE${stats.limited > 0 ? ` · ${stats.limited} LIMITED` : ''}`}
        title="Users."
        subtitle="Each user is one subscription URL. Disable, throttle, or revoke without touching the protocol layer."
        right={
          <Group gap={8}>
            <Tooltip label={t('common.refresh')}>
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => qc.invalidateQueries({ queryKey: ['users'] })}
                loading={usersQuery.isFetching}
                style={{ color: MIST }}
              >
                <IconRefresh size={18} />
              </ActionIcon>
            </Tooltip>
            <Button
              leftSection={<IconPlus size={14} />}
              onClick={openCreate}
              style={{
                backgroundColor: CYAN,
                color: GROUND,
                fontWeight: 500,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                fontSize: 12,
                height: 36,
              }}
            >
              {t('users.create')}
            </Button>
          </Group>
        }
      />

      {/* Stats row — clickable as filters */}
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }} spacing="sm">
        <StatChip
          icon={<IconUsers size={20} />}
          label={t('common.all')}
          value={stats.total}
          accent={CYAN}
          active={statusFilter === 'all'}
          onClick={() => setStatusFilter('all')}
        />
        <StatChip
          icon={<IconCircleCheck size={20} />}
          label="Active"
          value={stats.active}
          accent={MOSS}
          active={statusFilter === 'active'}
          onClick={() => setStatusFilter('active')}
        />
        <StatChip
          icon={<IconClockHour4 size={20} />}
          label="Expired"
          value={stats.expired}
          accent={RED}
          active={statusFilter === 'expired'}
          onClick={() => setStatusFilter('expired')}
        />
        <StatChip
          icon={<IconCircleMinus size={20} />}
          label="Limited"
          value={stats.limited}
          accent={AMBER}
          active={statusFilter === 'limited'}
          onClick={() => setStatusFilter('limited')}
        />
        <StatChip
          icon={<IconCircleOff size={20} />}
          label="Disabled"
          value={stats.disabled}
          accent={MIST}
          active={statusFilter === 'disabled'}
          onClick={() => setStatusFilter('disabled')}
        />
      </SimpleGrid>

      {/* Search + filters */}
      <Group gap="sm" wrap="nowrap">
        <TextInput
          placeholder={t('users.searchPlaceholder')}
          leftSection={<IconSearch size={16} color={MIST} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1 }}
          styles={{
            input: { backgroundColor: CARD, borderColor: HAIRLINE, color: SNOW },
          }}
        />
        <SegmentedControl
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
          data={[
            { value: 'all', label: t('common.all') },
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
      <Card withBorder padding={0} radius="md" style={{ backgroundColor: CARD, borderColor: HAIRLINE }}>
        <Table.ScrollContainer minWidth={1100}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
                <Table.Th style={MONO_LABEL}>{t('users.table.username')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.status')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.subscription')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.expires')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.traffic')}</Table.Th>
                <Table.Th style={MONO_LABEL}>{t('users.table.squads')}</Table.Th>
                <Table.Th style={MONO_LABEL}>Tag</Table.Th>
                <Table.Th style={{ width: 1, ...MONO_LABEL }}>{t('common.actions')}</Table.Th>
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
                          ? t('users.empty')
                          : t('common.nothingFound')}
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
                    ? MOSS
                    : trafficPct >= 90
                      ? RED
                      : trafficPct >= 70
                        ? AMBER
                        : MOSS;
                const statusAccent = STATUS_ACCENT[u.status] ?? MIST;
                const rowTint =
                  u.status === 'expired'
                    ? `${RED}08`
                    : u.status === 'limited'
                      ? `${AMBER}08`
                      : undefined;
                const otherSquads = u.groupIds.filter(
                  (id) => id !== '00000000-0000-0000-0000-000000000001',
                );

                return (
                  <Table.Tr
                    key={u.id}
                    style={{
                      backgroundColor: rowTint,
                      borderBottom: `1px solid ${HAIRLINE}`,
                    }}
                  >
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        <StatusDot accent={statusAccent} />
                        <Stack gap={0}>
                          <Text size="sm" fw={600} style={{ color: SNOW }}>
                            {u.username}
                          </Text>
                          <Text size="xs" style={{ ...MONO, color: MIST }}>
                            {u.shortId}
                          </Text>
                        </Stack>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        style={{
                          backgroundColor: `${statusAccent}1A`,
                          color: statusAccent,
                          border: `1px solid ${statusAccent}33`,
                          textTransform: 'uppercase',
                          ...MONO,
                          letterSpacing: '0.08em',
                        }}
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
                          style={{
                            color:
                              last.tone === 'fresh' ? MOSS : last.tone === 'never' ? MIST : SNOW,
                          }}
                        >
                          {last.text}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={u.expireAt ? new Date(u.expireAt).toLocaleString() : '—'}>
                        <Text
                          size="sm"
                          style={{
                            color:
                              exp.tone === 'bad'
                                ? RED
                                : exp.tone === 'warn'
                                  ? AMBER
                                  : exp.tone === 'never'
                                    ? MIST
                                    : SNOW,
                          }}
                        >
                          {exp.text}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td miw={200}>
                      <Stack gap={4}>
                        <Group justify="space-between" gap="xs">
                          <Text size="xs" style={{ ...MONO, color: SNOW }}>
                            {formatBytes(u.trafficUsedBytes)}{' '}
                            <Text span style={{ color: MIST }}>
                              /{' '}
                              {u.trafficLimitBytes === null
                                ? '∞'
                                : formatBytes(u.trafficLimitBytes)}
                            </Text>
                          </Text>
                          {trafficPct !== null && (
                            <Text size="xs" fw={600} style={{ ...MONO, color: trafficColor }}>
                              {trafficPct.toFixed(0)}%
                            </Text>
                          )}
                        </Group>
                        <Progress
                          value={trafficPct ?? 0}
                          size="sm"
                          radius="xl"
                          styles={{
                            root: { backgroundColor: HAIRLINE },
                            section: { backgroundColor: trafficColor },
                          }}
                        />
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      {otherSquads.length === 0 ? (
                        <Badge
                          variant="default"
                          size="sm"
                          style={{ backgroundColor: `${MIST}1A`, color: MIST }}
                        >
                          All
                        </Badge>
                      ) : (
                        <Group gap={4}>
                          {otherSquads.slice(0, 2).map((id) => (
                            <Badge
                              key={id}
                              variant="light"
                              size="sm"
                              style={{
                                backgroundColor: `${VIOLET}1A`,
                                color: VIOLET,
                                border: `1px solid ${VIOLET}33`,
                              }}
                            >
                              {squadNameById.get(id) ?? id.slice(0, 6)}
                            </Badge>
                          ))}
                          {otherSquads.length > 2 && (
                            <Badge
                              variant="default"
                              size="sm"
                              style={{ backgroundColor: `${MIST}1A`, color: MIST }}
                            >
                              +{otherSquads.length - 2}
                            </Badge>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {u.tag ? (
                        <Badge
                          variant="outline"
                          size="sm"
                          style={{ borderColor: HAIRLINE, color: MIST, ...MONO }}
                        >
                          {u.tag}
                        </Badge>
                      ) : (
                        <Text size="xs" style={{ color: MIST }}>
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Group gap={2} wrap="nowrap">
                        <SubscriptionCell url={subscriptionUrl(u.subscriptionToken)} />
                        <Tooltip label={t('common.edit')}>
                          <ActionIcon variant="subtle" onClick={() => setEditing(u)} size="sm">
                            <IconEdit size={14} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t('common.delete')}>
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

function StatusDot({ accent }: { accent: string }) {
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        backgroundColor: accent,
        boxShadow: `0 0 8px ${accent}99`,
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  );
}
