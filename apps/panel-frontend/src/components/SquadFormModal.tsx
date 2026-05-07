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
import { useQuery } from '@tanstack/react-query';
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLink,
  IconSearch,
  IconServer2,
  IconShieldLock,
  IconUsers,
} from '@tabler/icons-react';
import {
  ALL_SQUAD_ID,
  listNodes,
  type CreateSquadInput,
  type Inbound,
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
  inboundIds: string[];
}

function defaultValues(squad: Squad | null): FormValues {
  return {
    name: squad?.name ?? '',
    description: squad?.description ?? '',
    inboundIds: squad?.inboundIds ?? [],
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  squad: Squad | null;
  inbounds: Inbound[];
  onSubmit: (input: CreateSquadInput | UpdateSquadInput) => Promise<void>;
  loading?: boolean;
}

export function SquadFormModal({ opened, onClose, squad, inbounds, onSubmit, loading }: Props) {
  const isEdit = squad !== null;
  const isAllSquad = squad?.id === ALL_SQUAD_ID;
  const [search, setSearch] = useState('');

  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => listNodes({ page: 1, limit: 100 }),
  });
  const nodes = nodesQuery.data?.nodes ?? [];

  const form = useForm<FormValues>({
    initialValues: defaultValues(squad),
    validate: {
      name: (v) =>
        v.length < 1 || !/^[A-Za-z0-9 _-]+$/.test(v)
          ? 'Только буквы, цифры, пробел, _ и -'
          : null,
    },
  });

  // Sync form when opening edit on a different squad.
  if (opened && squad && form.values.name !== squad.name) {
    form.setValues(defaultValues(squad));
  }

  // Group inbounds by node, with a "no node" bucket as fallback. Search
  // filters at the inbound level — empty groups are hidden from the UI.
  const groupedInbounds = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inbounds.filter((ib) => {
      if (!q) return true;
      return (
        ib.name.toLowerCase().includes(q) ||
        ib.protocol.toLowerCase().includes(q) ||
        String(ib.port).includes(q)
      );
    });
    const byNode = new Map<string, Inbound[]>();
    for (const ib of filtered) {
      const list = byNode.get(ib.nodeId) ?? [];
      list.push(ib);
      byNode.set(ib.nodeId, list);
    }
    return Array.from(byNode.entries()).map(([nodeId, list]) => {
      const node = nodes.find((n) => n.id === nodeId);
      return {
        nodeId,
        nodeName: node?.name ?? '(unknown node)',
        nodeAddress: node?.address ?? '',
        countryCode: node?.countryCode ?? null,
        inbounds: list.sort((a, b) => a.port - b.port),
      };
    }).sort((a, b) => a.nodeName.localeCompare(b.nodeName));
  }, [inbounds, nodes, search]);

  async function handleSubmit(values: FormValues) {
    const base = {
      name: values.name,
      description: values.description.trim() || null,
      inboundIds: values.inboundIds,
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

  function toggleInbound(id: string) {
    if (isAllSquad) return;
    const cur = form.values.inboundIds;
    form.setFieldValue(
      'inboundIds',
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  function toggleAllInGroup(group: { inbounds: Inbound[] }) {
    if (isAllSquad) return;
    const ids = group.inbounds.map((ib) => ib.id);
    const cur = new Set(form.values.inboundIds);
    const allSelected = ids.every((id) => cur.has(id));
    if (allSelected) {
      for (const id of ids) cur.delete(id);
    } else {
      for (const id of ids) cur.add(id);
    }
    form.setFieldValue('inboundIds', Array.from(cur));
  }

  const selectedCount = form.values.inboundIds.length;

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
          {/* Header card — only on edit */}
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
                  <Tooltip label="Inbound'ов выбрано">
                    <Badge variant="light" color="indigo" leftSection={<IconLink size={11} />}>
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
              <b>All</b> — системный сквад. Авто-привязывается к каждому новому inbound'у
              и каждому новому пользователю. Переименовать, изменить состав или удалить нельзя.
            </Alert>
          )}

          {/* Name + description */}
          <Group grow align="flex-start">
            <TextInput
              label="Имя"
              placeholder="Trial / VIP / Stage"
              required
              disabled={isAllSquad}
              {...form.getInputProps('name')}
            />
          </Group>
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
                  Inbound'ы
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
              placeholder="Поиск по имени / протоколу / порту…"
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          )}

          {/* Grouped inbound list */}
          <Stack gap="sm" mah={400} style={{ overflowY: 'auto' }}>
            {groupedInbounds.length === 0 ? (
              <Paper withBorder p="md" radius="sm" ta="center">
                <Text c="dimmed" size="sm">
                  {inbounds.length === 0
                    ? 'Inbound\'ов в системе пока нет.'
                    : 'Ничего не найдено по поиску.'}
                </Text>
              </Paper>
            ) : (
              groupedInbounds.map((group) => (
                <NodeGroup
                  key={group.nodeId}
                  group={group}
                  selectedIds={new Set(form.values.inboundIds)}
                  disabled={isAllSquad}
                  onToggle={toggleInbound}
                  onToggleAll={() => toggleAllInGroup(group)}
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

// ───── Node group section ─────

function NodeGroup({
  group,
  selectedIds,
  disabled,
  onToggle,
  onToggleAll,
}: {
  group: {
    nodeId: string;
    nodeName: string;
    nodeAddress: string;
    countryCode: string | null;
    inbounds: Inbound[];
  };
  selectedIds: Set<string>;
  disabled?: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}) {
  const [open, setOpen] = useState(true);
  const ids = group.inbounds.map((ib) => ib.id);
  const allSelected = ids.every((id) => selectedIds.has(id));
  const someSelected = ids.some((id) => selectedIds.has(id));

  return (
    <Card withBorder padding="xs" radius="sm">
      <Group
        gap="sm"
        wrap="nowrap"
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer' }}
      >
        <ThemeIcon variant="subtle" color="gray" size="sm">
          {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </ThemeIcon>
        <ThemeIcon variant="light" color="indigo" size="sm">
          <IconServer2 size={12} />
        </ThemeIcon>
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6}>
            {group.countryCode && (
              <Text size="sm">{flagEmoji(group.countryCode)}</Text>
            )}
            <Text size="sm" fw={600} truncate>
              {group.nodeName}
            </Text>
          </Group>
          {group.nodeAddress && (
            <Text size="xs" c="dimmed" truncate>
              {group.nodeAddress}
            </Text>
          )}
        </Stack>
        <Badge variant="light" color={allSelected ? 'teal' : 'gray'} size="sm">
          {ids.filter((id) => selectedIds.has(id)).length}/{ids.length}
        </Badge>
        <Tooltip
          label={allSelected ? 'Снять все' : 'Выбрать все'}
        >
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggleAll}
          />
        </Tooltip>
      </Group>

      {open && (
        <Stack gap={4} mt="xs" pl="lg">
          {group.inbounds.map((ib) => (
            <InboundRow
              key={ib.id}
              inbound={ib}
              checked={selectedIds.has(ib.id)}
              disabled={disabled}
              onToggle={() => onToggle(ib.id)}
            />
          ))}
        </Stack>
      )}
    </Card>
  );
}

function InboundRow({
  inbound,
  checked,
  disabled,
  onToggle,
}: {
  inbound: Inbound;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <Paper
      withBorder
      p="xs"
      radius="sm"
      onClick={disabled ? undefined : onToggle}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Checkbox checked={checked} disabled={disabled} readOnly />
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text size="sm" fw={500} truncate>
                {inbound.name}
              </Text>
              {!inbound.enabled && (
                <Badge variant="default" color="gray" size="xs">
                  off
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" ff="monospace">
              :{inbound.port}
            </Text>
          </Stack>
        </Group>
        <Badge
          variant="light"
          color={PROTOCOL_COLORS[inbound.protocol] ?? 'gray'}
          size="sm"
          tt="uppercase"
        >
          {inbound.protocol}
        </Badge>
      </Group>
    </Paper>
  );
}

function flagEmoji(cc: string): string {
  if (cc.length !== 2) return '';
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return (
    String.fromCodePoint(A + (cc.toUpperCase().charCodeAt(0) - a)) +
    String.fromCodePoint(A + (cc.toUpperCase().charCodeAt(1) - a))
  );
}
