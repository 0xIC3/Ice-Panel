import { useState } from 'react';
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
import { useQuery } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import {
  IconCheck,
  IconChartBar,
  IconCopy,
  IconLink,
  IconLock,
  IconMail,
  IconShield,
  IconTag,
  IconUser,
} from '@tabler/icons-react';
import { copyToClipboard } from '../lib/clipboard';
import {
  ALL_SQUAD_ID,
  listSquads,
  subscriptionUrl,
  type CreateUserInput,
  type TrafficLimitStrategy,
  type UpdateUserInput,
  type User,
} from '../lib/api';

const STRATEGY_OPTIONS: { value: TrafficLimitStrategy; label: string }[] = [
  { value: 'no_reset', label: 'Никогда не сбрасывать' },
  { value: 'day', label: 'Ежедневно' },
  { value: 'week', label: 'Еженедельно' },
  { value: 'month', label: 'Ежемесячно' },
  { value: 'rolling', label: 'Скользящие 30 дней' },
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
    groupIds: user?.groupIds ?? [ALL_SQUAD_ID],
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
  const isEdit = user !== null;

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
    const groupIds = values.groupIds.includes(ALL_SQUAD_ID)
      ? values.groupIds
      : [ALL_SQUAD_ID, ...values.groupIds];

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

  const subUrl = user ? subscriptionUrl(user.subscriptionToken) : '';

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
          <Text fw={600}>{isEdit ? 'Редактирование' : 'Создание пользователя'}</Text>
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

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            {/* LEFT column */}
            <Stack gap="md">
              {!isEdit && (
                <SectionCard icon={<IconUser size={16} />} title="Идентификация">
                  <TextInput
                    label="Username"
                    placeholder="alice"
                    required
                    {...form.getInputProps('username')}
                  />
                </SectionCard>
              )}

              {isEdit && (
                <SectionCard icon={<IconLock size={16} />} title="Статус">
                  <Select
                    label="Статус пользователя"
                    data={[
                      { value: 'active', label: 'Active' },
                      { value: 'disabled', label: 'Disabled' },
                    ]}
                    {...form.getInputProps('status')}
                  />
                </SectionCard>
              )}

              <SectionCard icon={<IconChartBar size={16} />} title="Трафик и лимиты">
                <Stack gap="sm">
                  <NumberInput
                    label="Лимит трафика (ГБ)"
                    description="Оставь пустым — безлимит"
                    placeholder="500"
                    min={0}
                    allowDecimal={false}
                    allowNegative={false}
                    {...form.getInputProps('trafficLimitGb')}
                  />
                  <Select
                    label="Стратегия сброса"
                    description="Как часто обнулять расход"
                    data={STRATEGY_OPTIONS}
                    {...form.getInputProps('trafficLimitStrategy')}
                  />
                  {!isEdit && (
                    <NumberInput
                      label="Истекает через (дней)"
                      description="Оставь пустым — без срока"
                      placeholder="30"
                      min={1}
                      allowDecimal={false}
                      allowNegative={false}
                      {...form.getInputProps('expireDays')}
                    />
                  )}
                </Stack>
              </SectionCard>

              <SectionCard icon={<IconMail size={16} />} title="Контактная информация">
                <Stack gap="sm">
                  <TextInput
                    label="Email"
                    placeholder="user@example.com"
                    {...form.getInputProps('email')}
                  />
                  <TextInput
                    label="Telegram ID"
                    placeholder="optional"
                    {...form.getInputProps('telegramId')}
                  />
                </Stack>
              </SectionCard>

              <SectionCard icon={<IconTag size={16} />} title="Устройства и теги">
                <Stack gap="sm">
                  <NumberInput
                    label="Лимит HWID-устройств"
                    description="Оставь пустым — без ограничения"
                    placeholder="3"
                    min={1}
                    allowDecimal={false}
                    allowNegative={false}
                    {...form.getInputProps('hwidDeviceLimit')}
                  />
                  <TextInput
                    label="Tag"
                    placeholder="vip / trial / ..."
                    {...form.getInputProps('tag')}
                  />
                  <Textarea
                    label="Описание"
                    placeholder="Внутренняя заметка"
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
              <SectionCard icon={<IconShield size={16} />} title="Внутренние сквады">
                <Text size="xs" c="dimmed" mb="xs">
                  В каких группах состоит пользователь. «All» включена всегда автоматически.
                </Text>
                <Stack gap={6}>
                  {(squadsQuery.data?.squads ?? []).map((s) => {
                    const isAll = s.id === ALL_SQUAD_ID;
                    const checked = isAll || form.values.groupIds.includes(s.id);
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
              Отмена
            </Button>
            <Button type="submit" loading={loading} leftSection={<IconCheck size={16} />}>
              {isEdit ? 'Сохранить' : 'Создать'}
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
