import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconChartBar,
  IconCopy,
  IconDeviceDesktop,
  IconLink,
  IconLock,
  IconMail,
  IconShield,
  IconTag,
  IconTrash,
  IconUser,
} from '@tabler/icons-react';
import { copyToClipboard } from '../lib/clipboard';
import {
  ALL_SQUAD_ID,
  deleteHwidDevice,
  fetchAuthStatus,
  fetchUserEndpoints,
  listSquads,
  listUserDevices,
  subscriptionUrl,
  type CreateUserInput,
  type HwidDevice,
  type TrafficLimitStrategy,
  type UpdateUserInput,
  type User,
} from '../lib/api';

// Strategy values are stable enum keys; the label is built from the
// users.strategy.* i18n bundle inside the component so it follows the
// language switch.
const STRATEGY_VALUES: TrafficLimitStrategy[] = [
  'no_reset',
  'day',
  'week',
  'month',
  'rolling',
];

const STATUS_COLORS: Record<string, string> = {
  active: 'teal',
  disabled: 'gray',
  expired: 'red',
  limited: 'yellow',
};

const GiB = 1_073_741_824;

function formatBytes(n: number): string {
  if (n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

interface FormValues {
  username: string;
  trafficLimitGb: number | '';
  trafficLimitStrategy: TrafficLimitStrategy;
  expireDays: number | '';
  status: 'active' | 'disabled';
  description: string;
  tag: string;
  email: string;
  telegramId: string;
  hwidDeviceLimit: number | '';
  groupIds: string[];
}

function defaultValues(user: User | null): FormValues {
  return {
    username: user?.username ?? '',
    trafficLimitGb:
      user?.trafficLimitBytes != null ? Math.round(user.trafficLimitBytes / GiB) : '',
    trafficLimitStrategy: user?.trafficLimitStrategy ?? 'no_reset',
    expireDays: '',
    status: (user?.status as 'active' | 'disabled') ?? 'active',
    description: user?.description ?? '',
    tag: user?.tag ?? '',
    email: user?.email ?? '',
    telegramId: user?.telegramId ?? '',
    hwidDeviceLimit: user?.hwidDeviceLimit ?? '',
    // Empty by default — backend falls back to ALL squad if no squads
    // picked. Pre-checking ALL here doubles up: admin checks Basic too →
    // form sends [ALL, Basic] → user ends up in BOTH squads, which inflates
    // dashboard per-protocol counters and surprises admins ("я ж только в
    // Basic положил"). Leave it empty — admin explicitly picks, otherwise
    // server auto-falls back to ALL.
    groupIds: user?.groupIds ?? [],
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  user: User | null;
  onSubmit: (input: CreateUserInput | UpdateUserInput) => Promise<void>;
  loading?: boolean;
}

export function UserFormModal({ opened, onClose, user, onSubmit, loading }: Props) {
  const { t } = useTranslation();
  const isEdit = user !== null;
  // STRATEGY_VALUES are stable enum keys; we render labels via t() so the
  // language switch reflows the select without re-mounting the form.
  const strategyOptions = STRATEGY_VALUES.map((v) => ({
    value: v,
    label: t(`users.strategy.${v}`),
  }));

  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });

  const form = useForm<FormValues>({
    initialValues: defaultValues(user),
    validate: {
      username: (v) => {
        if (isEdit) return null;
        if (v.length < 3) return 'Минимум 3 символа';
        if (!/^[a-zA-Z0-9_-]+$/.test(v)) return 'Только буквы, цифры, _ и -';
        return null;
      },
      email: (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Некорректный email' : null),
    },
  });

  // Reset form when user prop changes
  if (opened && form.values.username === '' && user !== null) {
    form.setValues(defaultValues(user));
  }

  async function handleSubmit(values: FormValues) {
    // Send what admin picked, no automatic ALL squad injection. Backend
    // falls back to ALL only when groupIds is empty (so users without an
    // explicit squad still get a subscription). Earlier code force-merged
    // ALL into every submit, which doubled users into multiple squads and
    // broke the per-squad-ACL invariant.
    const groupIds = values.groupIds;

    if (isEdit) {
      const input: UpdateUserInput = {
        status: values.status,
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb),
        trafficLimitStrategy: values.trafficLimitStrategy,
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        telegramId: values.telegramId || null,
        hwidDeviceLimit:
          values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
        groupIds,
      };
      await onSubmit(input);
    } else {
      const input: CreateUserInput = {
        username: values.username,
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb),
        trafficLimitStrategy: values.trafficLimitStrategy,
        expireDays: values.expireDays === '' ? null : Number(values.expireDays),
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        telegramId: values.telegramId || null,
        hwidDeviceLimit:
          values.hwidDeviceLimit === '' ? null : Number(values.hwidDeviceLimit),
        groupIds,
      };
      await onSubmit(input);
    }
    onClose();
    form.reset();
  }

  // Panel metadata (publicUrl + subscriptionPathPrefix) — drives the
  // copy-paste subscription URL admin sees. Cached app-wide by query key.
  const authStatusQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: fetchAuthStatus,
    staleTime: 5 * 60 * 1000,
  });
  const subUrl = user
    ? subscriptionUrl(user.subscriptionToken, authStatusQuery.data?.panel)
    : '';

  // Per-protocol endpoint URIs for THIS user — fetched only when the
  // modal is open AND we have a user (i.e. editing, not creating). Each
  // endpoint exposes a ready-made URI string for client import / copy.
  const endpointsQuery = useQuery({
    queryKey: ['user-endpoints', user?.id],
    queryFn: () => fetchUserEndpoints(user!.id),
    enabled: opened && !!user?.id,
    staleTime: 30 * 1000,
  });

  return (
    <Modal
      opened={opened}
      onClose={() => {
        form.reset();
        onClose();
      }}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" radius="md" size={32}>
            <IconUser size={18} />
          </ThemeIcon>
          <Text fw={600}>{isEdit ? t('users.form.titleEdit') : t('users.form.titleCreate')}</Text>
        </Group>
      }
      size="xl"
      padding="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          {/* Profile header — only on edit */}
          {isEdit && user && (
            <ProfileHeader user={user} subUrl={subUrl} />
          )}

          {/* Per-protocol direct URIs — only on edit. Each endpoint
              (xray vless, hysteria2, ss, etc.) gets its own copy
              button so admin can ship a single-protocol link to a user
              without forcing them through a subscription importer. */}
          {isEdit && user && (
            <DirectEndpointsCard
              endpoints={endpointsQuery.data?.endpoints ?? []}
              loading={endpointsQuery.isLoading}
              error={endpointsQuery.error}
            />
          )}

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {/* LEFT column */}
            <Stack gap="md">
              {!isEdit && (
                <SectionCard icon={<IconUser size={16} />} title={t('users.form.sections.identity')}>
                  <TextInput
                    label={t('users.form.username')}
                    placeholder="alice"
                    required
                    {...form.getInputProps('username')}
                  />
                </SectionCard>
              )}

              {isEdit && (
                <SectionCard icon={<IconLock size={16} />} title={t('users.table.status')}>
                  <Select
                    label={t('users.table.status')}
                    data={[
                      { value: 'active', label: 'Active' },
                      { value: 'disabled', label: 'Disabled' },
                    ]}
                    {...form.getInputProps('status')}
                  />
                </SectionCard>
              )}

              <SectionCard icon={<IconChartBar size={16} />} title={t('users.form.sections.traffic')}>
                <Stack gap="sm">
                  <NumberInput
                    label={t('users.form.trafficLimit')}
                    description={t('users.form.trafficLimitDesc')}
                    placeholder="500"
                    min={0}
                    allowDecimal={false}
                    allowNegative={false}
                    {...form.getInputProps('trafficLimitGb')}
                  />
                  <Select
                    label={t('users.form.resetStrategy')}
                    description={t('users.form.resetStrategyDesc')}
                    data={strategyOptions}
                    {...form.getInputProps('trafficLimitStrategy')}
                  />
                  {!isEdit && (
                    <NumberInput
                      label={t('users.form.expireDays')}
                      description={t('users.form.expireDaysDesc')}
                      placeholder="30"
                      min={1}
                      allowDecimal={false}
                      allowNegative={false}
                      {...form.getInputProps('expireDays')}
                    />
                  )}
                </Stack>
              </SectionCard>

              <SectionCard icon={<IconMail size={16} />} title={t('users.form.sections.contact')}>
                <Stack gap="sm">
                  <TextInput
                    label={t('users.form.email')}
                    placeholder="user@example.com"
                    {...form.getInputProps('email')}
                  />
                  <TextInput
                    label={t('users.form.telegramId')}
                    placeholder={t('users.form.telegramIdPlaceholder')}
                    {...form.getInputProps('telegramId')}
                  />
                </Stack>
              </SectionCard>

              <SectionCard icon={<IconTag size={16} />} title={t('users.form.sections.devices')}>
                <Stack gap="sm">
                  <NumberInput
                    label={t('users.form.hwidLimit')}
                    description={t('users.form.hwidLimitDesc')}
                    placeholder="3"
                    min={1}
                    allowDecimal={false}
                    allowNegative={false}
                    {...form.getInputProps('hwidDeviceLimit')}
                  />
                  {user && <UserDevicesPanel userId={user.id} />}
                  <TextInput
                    label={t('users.form.tag')}
                    placeholder={t('users.form.tagPlaceholder')}
                    {...form.getInputProps('tag')}
                  />
                  <Textarea
                    label={t('users.form.description')}
                    placeholder={t('users.form.descriptionPlaceholder')}
                    autosize
                    minRows={2}
                    maxRows={4}
                    {...form.getInputProps('description')}
                  />
                </Stack>
              </SectionCard>
            </Stack>

            {/* RIGHT column */}
            <Stack gap="md">
              <SectionCard icon={<IconShield size={16} />} title={t('users.form.sections.squads')}>
                <Text size="xs" c="dimmed" mb="xs">
                  {t('users.form.squadsDesc')}
                </Text>
                <Stack gap={6}>
                  {(squadsQuery.data?.squads ?? []).map((s) => {
                    const isAll = s.id === ALL_SQUAD_ID;
                    const checked = form.values.groupIds.includes(s.id);
                    return (
                      <SquadRow
                        key={s.id}
                        name={s.name}
                        userCount={s.memberCount}
                        profileCount={s.profileIds.length}
                        checked={checked}
                        disabled={isAll}
                        onToggle={() => {
                          if (isAll) return;
                          const cur = form.values.groupIds;
                          form.setFieldValue(
                            'groupIds',
                            cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id],
                          );
                        }}
                      />
                    );
                  })}
                </Stack>
              </SectionCard>
            </Stack>
          </SimpleGrid>

          <Divider />

          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose} disabled={loading}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={loading} leftSection={<IconCheck size={16} />}>
              {isEdit ? t('users.form.submitEdit') : t('users.form.submitCreate')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ───── Helper components ─────

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="xs" mb="sm">
        <ThemeIcon variant="light" size={26} radius="md">
          {icon}
        </ThemeIcon>
        <Text fw={600} size="sm">
          {title}
        </Text>
      </Group>
      {children}
    </Card>
  );
}

function ProfileHeader({ user, subUrl }: { user: User; subUrl: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await copyToClipboard(subUrl);
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

  const used = user.trafficUsedBytes;
  const limit = user.trafficLimitBytes;
  const pct = limit !== null && limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const trafficColor = pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'teal';

  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group gap="md" wrap="nowrap">
          <ThemeIcon size={48} radius="md" variant="light">
            <IconUser size={24} />
          </ThemeIcon>
          <Stack gap={2}>
            <Group gap="xs">
              <Text size="lg" fw={700}>
                {user.username}
              </Text>
              <Badge variant="light" color={STATUS_COLORS[user.status] ?? 'gray'} tt="uppercase">
                {user.status}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" ff="monospace">
              {user.shortId}
            </Text>
          </Stack>
        </Group>
      </Group>

      {/* Traffic bar */}
      <Stack gap={4} mt="md">
        <Group justify="space-between">
          <Text size="sm" ff="monospace">
            {formatBytes(used)}{' '}
            <Text span c="dimmed">
              / {limit === null ? '∞' : formatBytes(limit)}
            </Text>
          </Text>
          {limit !== null && (
            <Text size="sm" c={trafficColor} ff="monospace" fw={600}>
              {pct.toFixed(1)}%
            </Text>
          )}
        </Group>
        <Progress value={pct} color={trafficColor} size="sm" radius="xl" />
      </Stack>

      {/* Subscription URL */}
      <Paper withBorder mt="md" p="xs" radius="sm">
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon variant="subtle" size={22} radius="sm" color="gray">
            <IconLink size={14} />
          </ThemeIcon>
          <Code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subUrl}
          </Code>
          <Tooltip label={copied ? 'Скопировано' : 'Скопировать'}>
            <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={handleCopy}>
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Paper>
    </Card>
  );
}

function SquadRow({
  name,
  userCount,
  profileCount,
  checked,
  disabled,
  onToggle,
}: {
  name: string;
  userCount: number;
  profileCount: number;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Paper
      withBorder
      p="sm"
      radius="sm"
      onClick={disabled ? undefined : onToggle}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm">
          <Checkbox checked={checked} disabled={disabled} readOnly />
          <Text size="sm" fw={500}>
            {name}
          </Text>
        </Group>
        <Group gap={4}>
          <Tooltip label="Пользователей">
            <Badge variant="light" color="blue" size="sm">
              {userCount}
            </Badge>
          </Tooltip>
          <Tooltip label="Профилей">
            <Badge variant="light" color="indigo" size="sm">
              {profileCount}
            </Badge>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}

// ───── Slice S2: HWID devices panel ─────

/**
 * Lists HWID-tracked devices currently registered for this user. Each
 * row shows the hwid (truncated), first-seen / last-seen, and a delete
 * button to revoke the slot — admins use this to clean up after the
 * user replaced a phone or laptop.
 *
 * Devices are populated lazily on /sub/:token requests carrying an
 * `x-hwid` header. Empty list = either the user never opened a
 * HWID-aware client or no limit is set.
 */
function UserDevicesPanel({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const devicesQuery = useQuery({
    queryKey: ['hwid-devices', userId],
    queryFn: () => listUserDevices(userId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteHwidDevice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hwid-devices', userId] });
      notifications.show({ color: 'green', message: t('common.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const devices = devicesQuery.data?.devices ?? [];

  return (
    <Stack gap={4}>
      <Group gap={6}>
        <IconDeviceDesktop size={14} />
        <Text size="sm" fw={500}>
          {t('users.form.devicesTitle', { count: devices.length })}
        </Text>
      </Group>
      {devices.length === 0 ? (
        <Text size="xs" c="dimmed">
          {t('users.form.devicesEmpty')}
        </Text>
      ) : (
        <Stack gap={4}>
          {devices.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              onDelete={() => deleteMutation.mutate(d.id)}
              deleting={
                deleteMutation.isPending &&
                deleteMutation.variables === d.id
              }
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function DeviceRow({
  device,
  onDelete,
  deleting,
}: {
  device: HwidDevice;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const truncated =
    device.hwid.length > 24 ? `${device.hwid.slice(0, 21)}…` : device.hwid;
  const lastSeen = new Date(device.lastSeenAt).toLocaleString();
  return (
    <Paper withBorder p="xs" radius="sm">
      <Group justify="space-between" wrap="nowrap">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Group gap={6}>
            <Text size="xs" ff="monospace" truncate>
              {truncated}
            </Text>
            {device.label && (
              <Badge size="xs" variant="light">
                {device.label}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {t('users.form.deviceLastSeen', { when: lastSeen })}
          </Text>
        </Stack>
        <Tooltip label={t('users.form.deviceDelete')}>
          <ActionIcon
            variant="subtle"
            color="red"
            size="sm"
            loading={deleting}
            onClick={onDelete}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
}

// ───── Direct per-protocol URIs ─────
//
// Shows a card with one row per enabled endpoint (vless://, hysteria2://,
// ss://, awg-style identifier, etc) plus a "Copy" button. AWG has no URI
// scheme upstream — admin gets a placeholder pointing at the wgconf
// download link instead. Asked-for in cycle #6 2026-05-13: operators
// who deal with non-Hiddify clients (raw v2rayN, Shadowrocket) want a
// single-protocol link without the subscription wrapper.
function DirectEndpointsCard({
  endpoints,
  loading,
  error,
}: {
  endpoints: Array<{ protocol: string; nodeName: string; host: string; port: number; uri: string }>;
  loading: boolean;
  error: unknown;
}) {
  if (loading) {
    return (
      <SectionCard icon={<IconLink size={16} />} title="Прямые ссылки по протоколам">
        <Text size="xs" c="dimmed">Загрузка…</Text>
      </SectionCard>
    );
  }
  if (error) {
    return (
      <SectionCard icon={<IconLink size={16} />} title="Прямые ссылки по протоколам">
        <Text size="xs" c="red">{error instanceof Error ? error.message : String(error)}</Text>
      </SectionCard>
    );
  }
  if (endpoints.length === 0) {
    return (
      <SectionCard icon={<IconLink size={16} />} title="Прямые ссылки по протоколам">
        <Text size="xs" c="dimmed">
          Нет активных endpoint'ов. Привяжи юзера к squad с inbound'ами и разверни профиль на ноду.
        </Text>
      </SectionCard>
    );
  }
  return (
    <SectionCard icon={<IconLink size={16} />} title="Прямые ссылки по протоколам">
      <Stack gap={6}>
        {endpoints.map((e, idx) => (
          <DirectEndpointRow key={`${e.protocol}-${e.host}-${e.port}-${idx}`} endpoint={e} />
        ))}
        <Text size="xs" c="dimmed">
          Каждая ссылка — single-protocol импорт для клиентов которые не умеют subscription URL (raw v2rayN / Shadowrocket / Hiddify Manual Add).
        </Text>
      </Stack>
    </SectionCard>
  );
}

function DirectEndpointRow({
  endpoint,
}: {
  endpoint: { protocol: string; nodeName: string; host: string; port: number; uri: string };
}) {
  const [copied, setCopied] = useState(false);
  const hasUri = endpoint.uri.length > 0;

  async function handleCopy() {
    if (!hasUri) return;
    try {
      await copyToClipboard(endpoint.uri);
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
    <Paper withBorder p="xs" radius="sm">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <Badge variant="light" color="cyan" size="xs" tt="uppercase">
            {endpoint.protocol}
          </Badge>
          <Text size="xs" c="dimmed" truncate>
            {endpoint.nodeName} · {endpoint.host}:{endpoint.port}
          </Text>
        </Group>
        {hasUri ? (
          <Tooltip label={copied ? 'Copied!' : 'Copy URI'}>
            <ActionIcon variant="light" size="sm" onClick={handleCopy} color={copied ? 'green' : 'blue'}>
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        ) : (
          <Tooltip label="Для AmneziaWG нет стандартного URI — используй subscription URL с ?format=wgconf">
            <Badge variant="light" color="gray" size="xs">wgconf only</Badge>
          </Tooltip>
        )}
      </Group>
      {hasUri && (
        <Text size="xs" c="dimmed" ff="monospace" truncate mt={2}>
          {endpoint.uri}
        </Text>
      )}
    </Paper>
  );
}
