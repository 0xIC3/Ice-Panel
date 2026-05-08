import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  IconBolt,
  IconCheck,
  IconLink,
  IconSearch,
  IconShieldLock,
  IconUsers,
} from '@tabler/icons-react';
import {
  ALL_SQUAD_ID,
  type CreateSquadInput,
  type Profile,
  type Squad,
  type UpdateSquadInput,
} from '../lib/api';

const PROTOCOL_COLORS: Record<string, string> = {
  hysteria: 'blue',
  xray: 'violet',
  amneziawg: 'teal',
  naive: 'orange',
  shadowsocks: 'pink',
  mtproto: 'cyan',
  mieru: 'grape',
};

interface FormValues {
  name: string;
  description: string;
  profileIds: string[];
}

function defaultValues(squad: Squad | null): FormValues {
  return {
    name: squad?.name ?? '',
    description: squad?.description ?? '',
    profileIds: squad?.profileIds ?? [],
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  squad: Squad | null;
  /** Slice 27 — squad ACL operates on profiles, not per-node inbounds. */
  profiles: Profile[];
  /** Optional: count of bindings per profile, for the "deployed on N nodes"
   *  hint in each row. Computed by parent from listBindings(). */
  bindingsByProfile?: Map<string, number>;
  onSubmit: (input: CreateSquadInput | UpdateSquadInput) => Promise<void>;
  loading?: boolean;
}

export function SquadFormModal({
  opened,
  onClose,
  squad,
  profiles,
  bindingsByProfile,
  onSubmit,
  loading,
}: Props) {
  const isEdit = squad !== null;
  const isAllSquad = squad?.id === ALL_SQUAD_ID;
  const [search, setSearch] = useState('');

  const form = useForm<FormValues>({
    initialValues: defaultValues(squad),
    validate: {
      name: (v) =>
        v.length < 1 || !/^[A-Za-z0-9 _-]+$/.test(v)
          ? 'Только буквы, цифры, пробел, _ и -'
          : null,
    },
  });

  if (opened && squad && form.values.name !== squad.name) {
    form.setValues(defaultValues(squad));
  }

  // Group profiles by protocol so admin can quickly toggle whole protocol
  // families. Search filters at the profile level.
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = profiles.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.protocol.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
      );
    });
    const byProto = new Map<string, Profile[]>();
    for (const p of filtered) {
      const list = byProto.get(p.protocol) ?? [];
      list.push(p);
      byProto.set(p.protocol, list);
    }
    return Array.from(byProto.entries())
      .map(([protocol, list]) => ({
        protocol,
        profiles: list.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.protocol.localeCompare(b.protocol));
  }, [profiles, search]);

  async function handleSubmit(values: FormValues) {
    const base = {
      name: values.name,
      description: values.description.trim() || null,
      profileIds: values.profileIds,
    };
    if (isEdit) {
      await onSubmit(base satisfies UpdateSquadInput);
    } else {
      await onSubmit(base satisfies CreateSquadInput);
    }
    onClose();
    form.reset();
    setSearch('');
  }

  function toggleProfile(id: string) {
    if (isAllSquad) return;
    const cur = form.values.profileIds;
    form.setFieldValue(
      'profileIds',
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  function toggleAllInGroup(list: Profile[]) {
    if (isAllSquad) return;
    const ids = list.map((p) => p.id);
    const cur = new Set(form.values.profileIds);
    const allSelected = ids.every((id) => cur.has(id));
    if (allSelected) {
      for (const id of ids) cur.delete(id);
    } else {
      for (const id of ids) cur.add(id);
    }
    form.setFieldValue('profileIds', Array.from(cur));
  }

  const selectedCount = form.values.profileIds.length;

  return (
    <Modal
      opened={opened}
      onClose={() => {
        form.reset();
        setSearch('');
        onClose();
      }}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" radius="md" size={32} color="indigo">
            <IconLink size={18} />
          </ThemeIcon>
          <Text fw={600}>{isEdit ? 'Изменить сквад' : 'Создать сквад'}</Text>
        </Group>
      }
      size="lg"
      padding="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          {isEdit && squad && (
            <Card
              withBorder
              padding="md"
              radius="md"
              style={{
                borderLeftWidth: 3,
                borderLeftColor: isAllSquad
                  ? 'var(--mantine-color-teal-6)'
                  : 'var(--mantine-color-indigo-6)',
              }}
            >
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm">
                  <ThemeIcon
                    size={40}
                    radius="md"
                    variant="light"
                    color={isAllSquad ? 'teal' : 'indigo'}
                  >
                    <IconLink size={20} />
                  </ThemeIcon>
                  <Stack gap={0}>
                    <Group gap={6}>
                      <Text fw={700}>{squad.name}</Text>
                      {isAllSquad && (
                        <Tooltip label="Системный сквад">
                          <IconShieldLock
                            size={13}
                            color="var(--mantine-color-yellow-6)"
                          />
                        </Tooltip>
                      )}
                    </Group>
                    {squad.description && (
                      <Text size="xs" c="dimmed">
                        {squad.description}
                      </Text>
                    )}
                  </Stack>
                </Group>
                <Group gap="xs">
                  <Tooltip label="Профилей выбрано">
                    <Badge variant="light" color="indigo" leftSection={<IconBolt size={11} />}>
                      {selectedCount}
                    </Badge>
                  </Tooltip>
                  <Tooltip label="Участников">
                    <Badge variant="light" color="blue" leftSection={<IconUsers size={11} />}>
                      {squad.memberCount}
                    </Badge>
                  </Tooltip>
                </Group>
              </Group>
            </Card>
          )}

          {isAllSquad && (
            <Alert color="yellow" icon={<IconShieldLock size={18} />}>
              <b>All</b> — системный сквад. Авто-привязывается к каждому новому профилю
              и каждому новому пользователю. Переименовать, изменить состав или удалить нельзя.
            </Alert>
          )}

          <TextInput
            label="Имя"
            placeholder="Trial / VIP / Stage"
            required
            disabled={isAllSquad}
            {...form.getInputProps('name')}
          />
          <Textarea
            label="Описание"
            placeholder="Зачем эта группа нужна (необязательно)"
            autosize
            minRows={2}
            disabled={isAllSquad}
            {...form.getInputProps('description')}
          />

          <Divider
            label={
              <Group gap={6}>
                <Text size="sm" fw={600}>
                  Профили
                </Text>
                <Badge size="sm" variant="light" color="indigo">
                  {selectedCount} выбрано
                </Badge>
              </Group>
            }
            labelPosition="left"
          />

          {!isAllSquad && (
            <TextInput
              placeholder="Поиск по имени / протоколу…"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          )}

          <Stack gap="sm" mah={520} style={{ overflowY: 'auto', paddingRight: 4 }}>
            {grouped.length === 0 ? (
              <Paper withBorder p="md" radius="sm" ta="center">
                <Text c="dimmed" size="sm">
                  {profiles.length === 0
                    ? 'Профилей в системе пока нет.'
                    : 'Ничего не найдено по поиску.'}
                </Text>
              </Paper>
            ) : (
              grouped.map((g) => (
                <ProtocolGroup
                  key={g.protocol}
                  protocol={g.protocol}
                  profiles={g.profiles}
                  selectedIds={new Set(form.values.profileIds)}
                  bindingsByProfile={bindingsByProfile}
                  disabled={isAllSquad}
                  onToggle={toggleProfile}
                  onToggleAll={() => toggleAllInGroup(g.profiles)}
                />
              ))
            )}
          </Stack>

          <Divider />

          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose} disabled={loading}>
              {isAllSquad ? 'Закрыть' : 'Отмена'}
            </Button>
            {!isAllSquad && (
              <Button type="submit" loading={loading} leftSection={<IconCheck size={16} />}>
                {isEdit ? 'Сохранить' : 'Создать'}
              </Button>
            )}
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ───── Per-protocol group ─────

function ProtocolGroup({
  protocol,
  profiles,
  selectedIds,
  bindingsByProfile,
  disabled,
  onToggle,
  onToggleAll,
}: {
  protocol: string;
  profiles: Profile[];
  selectedIds: Set<string>;
  bindingsByProfile?: Map<string, number>;
  disabled?: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const ids = profiles.map((p) => p.id);
  const allSelected = ids.every((id) => selectedIds.has(id));
  const someSelected = ids.some((id) => selectedIds.has(id));
  const color = PROTOCOL_COLORS[protocol] ?? 'gray';

  return (
    <Card
      withBorder
      padding="sm"
      radius="md"
      style={{
        borderLeft: `3px solid var(--mantine-color-${color}-6)`,
      }}
    >
      <Group gap="sm" wrap="nowrap" mb="sm">
        <ThemeIcon variant="light" color={color} size="md">
          <IconBolt size={14} />
        </ThemeIcon>
        <Text size="sm" fw={700} tt="uppercase" style={{ flex: 1, letterSpacing: 0.5 }}>
          {protocol}
        </Text>
        <Badge
          variant={allSelected ? 'filled' : 'light'}
          color={allSelected ? 'teal' : 'gray'}
          size="sm"
        >
          {ids.filter((id) => selectedIds.has(id)).length}/{ids.length}
        </Badge>
        <Tooltip label={allSelected ? 'Снять все' : 'Выбрать все'}>
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            disabled={disabled}
            onChange={onToggleAll}
          />
        </Tooltip>
      </Group>

      <Stack gap={6}>
        {profiles.map((p) => (
          <ProfileRow
            key={p.id}
            profile={p}
            checked={selectedIds.has(p.id)}
            bindingCount={bindingsByProfile?.get(p.id) ?? p.bindingCount}
            disabled={disabled}
            onToggle={() => onToggle(p.id)}
          />
        ))}
      </Stack>
    </Card>
  );
}

function ProfileRow({
  profile,
  checked,
  bindingCount,
  disabled,
  onToggle,
}: {
  profile: Profile;
  checked: boolean;
  bindingCount: number;
  disabled?: boolean;
  onToggle: () => void;
}) {
  // Plain Group wrapped in a borderless container — nesting Paper inside
  // Card creates overflow clipping in Mantine 7.x because both wrap content
  // in `position: relative` boxes and the inner Stack ends up taller than
  // the parent Card thinks it is. Flat row keeps the same UX without the
  // visual artifacts.
  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      onClick={disabled ? undefined : onToggle}
      px="xs"
      py={6}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        borderRadius: 6,
        background: checked ? 'var(--mantine-color-dark-6)' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
        <Checkbox checked={checked} disabled={disabled} readOnly tabIndex={-1} />
        <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={500} truncate>
              {profile.name}
            </Text>
            {!profile.enabled && (
              <Badge variant="default" color="gray" size="xs">
                off
              </Badge>
            )}
          </Group>
          {profile.description && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {profile.description}
            </Text>
          )}
        </Stack>
      </Group>
      <Tooltip label="Развёрнут на нодах">
        <Badge variant="outline" color="gray" size="sm">
          {bindingCount}
        </Badge>
      </Tooltip>
    </Group>
  );
}
