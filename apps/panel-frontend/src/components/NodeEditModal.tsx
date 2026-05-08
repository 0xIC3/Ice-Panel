import { useEffect } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import {
  IconActivity,
  IconBolt,
  IconCpu,
  IconDatabase,
  IconDeviceFloppy,
  IconKey,
  IconLink,
  IconRocket,
  IconTrash,
  IconWorld,
} from '@tabler/icons-react';
import {
  createBinding,
  deleteBinding,
  getDashboardOverview,
  listBindings,
  listProfiles,
  type Node as PanelNode,
  type NodeProtocol,
  type UpdateNodeInput,
} from '../lib/api';
import { COUNTRY_OPTIONS, countryFlag } from '../lib/countries';

const PROTOCOL_OPTIONS: { value: NodeProtocol; label: string }[] = [
  { value: 'xray', label: 'Xray (VLESS / Trojan + REALITY)' },
  { value: 'hysteria', label: 'Hysteria 2' },
  { value: 'amneziawg', label: 'AmneziaWG' },
  { value: 'naive', label: 'NaiveProxy' },
  { value: 'shadowsocks', label: 'Shadowsocks 2022' },
  { value: 'mtproto', label: 'MTProto (Telegram-only)' },
  { value: 'mieru', label: 'Mieru (stealth proxy)' },
];

interface FormValues {
  name: string;
  address: string;
  protocol: NodeProtocol;
  countryCode: string;
  consumptionMultiplier: number | '';
}

interface Props {
  opened: boolean;
  onClose: () => void;
  node: PanelNode | null;
  onSubmit: (input: UpdateNodeInput) => Promise<void>;
  onDelete: () => void;
  onRefreshBootstrap: () => void;
  saving?: boolean;
  refreshing?: boolean;
}

export function NodeEditModal({
  opened,
  onClose,
  node,
  onSubmit,
  onDelete,
  onRefreshBootstrap,
  saving,
  refreshing,
}: Props) {
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    initialValues: {
      name: node?.name ?? '',
      address: node?.address ?? '',
      protocol: node?.protocol ?? 'xray',
      countryCode: node?.countryCode ?? '',
      consumptionMultiplier: node ? Number(node.consumptionMultiplier) : 1,
    },
  });

  useEffect(() => {
    if (opened && node) {
      form.setValues({
        name: node.name,
        address: node.address,
        protocol: node.protocol,
        countryCode: node.countryCode ?? '',
        consumptionMultiplier: Number(node.consumptionMultiplier),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, node]);

  // Live host-metrics + traffic — same source the cards on /nodes use.
  // Auto-refetch every 10s while modal is open so admin sees fresh data
  // without manual reload.
  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: getDashboardOverview,
    refetchInterval: opened ? 10_000 : false,
    enabled: opened,
  });
  const overviewNode = overviewQuery.data?.nodes.find((n) => n.id === node?.id);

  // Bindings deployed on this node (with profile info inlined — `listBindings`
  // doesn't include profile name, so we cross-reference with `listProfiles`).
  const bindingsQuery = useQuery({
    queryKey: ['bindings', { nodeId: node?.id }],
    queryFn: () => listBindings({ nodeId: node!.id }),
    enabled: opened && node !== null,
  });
  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: () => listProfiles(),
    enabled: opened,
  });
  const bindingsWithProfile = (bindingsQuery.data?.bindings ?? []).map((b) => {
    const p = (profilesQuery.data?.profiles ?? []).find((x) => x.id === b.profileId);
    return { binding: b, profile: p };
  });

  const removeBindingMutation = useMutation({
    mutationFn: deleteBinding,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bindings'] });
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      notifications.show({ color: 'green', message: 'Binding снят' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Не получилось снять',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  // Quick-deploy: auto-create binding for any selected available profile.
  const availableProfiles = (profilesQuery.data?.profiles ?? []).filter(
    (p) =>
      !bindingsWithProfile.some((bp) => bp.binding.profileId === p.id) &&
      p.protocol === form.values.protocol,
  );
  const addBindingMutation = useMutation({
    mutationFn: (profileId: string) =>
      createBinding({ profileId, nodeId: node!.id, port: 443 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bindings'] });
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      notifications.show({ color: 'green', message: 'Binding добавлен' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Не получилось задеплоить',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  if (!node) return null;

  async function handleSave() {
    await onSubmit({
      name: form.values.name,
      address: form.values.address,
      protocol: form.values.protocol,
      countryCode: form.values.countryCode || null,
      consumptionMultiplier:
        form.values.consumptionMultiplier === ''
          ? 1
          : Number(form.values.consumptionMultiplier),
    });
  }

  const m = overviewNode?.metrics;
  const statusColor =
    node.status === 'online' ? 'teal' : node.status === 'disabled' ? 'gray' : 'red';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="sm">
          <ThemeIcon variant="light" color={statusColor} size="md">
            <IconActivity size={16} />
          </ThemeIcon>
          <Stack gap={0}>
            <Group gap={6}>
              {node.countryCode && (
                <Text size="md" lh={1}>
                  {countryFlag(node.countryCode)}
                </Text>
              )}
              <Text fw={700}>{node.name}</Text>
              <Badge variant="light" color={statusColor} size="sm" tt="uppercase">
                {node.status}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" ff="monospace">
              {node.address}
            </Text>
          </Stack>
        </Group>
      }
      size="xl"
    >
      <Stack>
        {/* Status row — degraded reason если есть */}
        {node.lastStatusMessage && (
          <Alert color="yellow" variant="light" p="xs">
            <Text size="xs" ff="monospace">
              {node.lastStatusMessage}
            </Text>
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {/* LEFT — параметры */}
          <Card withBorder padding="md" radius="md">
            <Group gap="sm" mb="md">
              <ThemeIcon size={32} radius="md" variant="light" color="blue">
                <IconWorld size={16} />
              </ThemeIcon>
              <Text fw={600}>Параметры</Text>
            </Group>
            <Stack gap="sm">
              <Group grow>
                <TextInput
                  label="Имя"
                  required
                  {...form.getInputProps('name')}
                />
                <Select
                  label="Протокол"
                  data={PROTOCOL_OPTIONS}
                  allowDeselect={false}
                  {...form.getInputProps('protocol')}
                />
              </Group>
              <TextInput
                label="Адрес"
                description="host:port для panel-mTLS"
                required
                {...form.getInputProps('address')}
              />
              <Group grow>
                <Select
                  label="Страна"
                  data={COUNTRY_OPTIONS}
                  searchable
                  clearable
                  placeholder="Не указана"
                  {...form.getInputProps('countryCode')}
                />
                <NumberInput
                  label="Multiplier"
                  description="1 = норма"
                  min={0.1}
                  max={10}
                  step={0.1}
                  {...form.getInputProps('consumptionMultiplier')}
                />
              </Group>
            </Stack>
          </Card>

          {/* RIGHT — система (live metrics) */}
          <Card withBorder padding="md" radius="md">
            <Group justify="space-between" mb="md">
              <Group gap="sm">
                <ThemeIcon size={32} radius="md" variant="light" color="grape">
                  <IconCpu size={16} />
                </ThemeIcon>
                <Text fw={600}>Система</Text>
              </Group>
              {m && (
                <Badge variant="light" color="gray" size="xs" ff="monospace">
                  uptime {formatUptime(m.uptimeSeconds)}
                </Badge>
              )}
            </Group>
            {m ? (
              <Stack gap="xs">
                <MetricBar
                  icon={<IconCpu size={12} />}
                  label="CPU"
                  value={m.cpu.usagePercent}
                  detail={`${m.cpu.cores} ядер · LA ${m.cpu.loadAvg1.toFixed(2)}/${m.cpu.loadAvg5.toFixed(2)}/${m.cpu.loadAvg15.toFixed(2)}`}
                />
                <MetricBar
                  icon={<IconDatabase size={12} />}
                  label="RAM"
                  value={m.memory.usedPercent}
                  detail={`${formatBytes(m.memory.usedBytes)} / ${formatBytes(m.memory.totalBytes)}`}
                />
                <MetricBar
                  icon={<IconDeviceFloppy size={12} />}
                  label="Disk"
                  value={m.disk.usedPercent}
                  detail={`${formatBytes(m.disk.usedBytes)} / ${formatBytes(m.disk.totalBytes)}`}
                />
                <Divider my={4} />
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Сегодня
                  </Text>
                  <Text size="sm" fw={600} ff="monospace">
                    {formatBytes(overviewNode?.todayBytes ?? 0)}
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    Bindings
                  </Text>
                  <Text size="sm" fw={600}>
                    {overviewNode?.inboundCount ?? bindingsWithProfile.length}
                  </Text>
                </Group>
              </Stack>
            ) : (
              <Text size="xs" c="dimmed" ta="center" py="xl">
                Метрики ещё не пришли — первый poll в течение 15 сек.
              </Text>
            )}
          </Card>
        </SimpleGrid>

        {/* Bindings — what's deployed on this node */}
        <Card withBorder padding="md" radius="md">
          <Group justify="space-between" mb="sm">
            <Group gap="sm">
              <ThemeIcon size={32} radius="md" variant="light" color="violet">
                <IconRocket size={16} />
              </ThemeIcon>
              <Text fw={600}>Bindings ({bindingsWithProfile.length})</Text>
            </Group>
          </Group>

          {bindingsWithProfile.length === 0 ? (
            <Text size="xs" c="dimmed" py="md" ta="center">
              На эту ноду пока ничего не задеплоено. Используй «Развернуть на
              нодах» в карточке Profile, или quick-deploy ниже.
            </Text>
          ) : (
            <Stack gap={4}>
              {bindingsWithProfile.map(({ binding, profile }) => (
                <Paper
                  key={binding.id}
                  withBorder
                  p="xs"
                  radius="sm"
                  style={{
                    borderLeft: `3px solid var(--mantine-color-violet-6)`,
                  }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      <IconBolt size={14} />
                      <Stack gap={0}>
                        <Group gap={6}>
                          <Text size="sm" fw={500} truncate>
                            {profile?.name ?? '<unknown>'}
                          </Text>
                          <Badge variant="light" color="cyan" size="xs" tt="uppercase">
                            {profile?.protocol ?? '?'}
                          </Badge>
                          <Badge variant="light" color="gray" size="xs" ff="monospace">
                            :{binding.port}
                          </Badge>
                        </Group>
                        {binding.publicHost && (
                          <Text size="xs" c="dimmed" ff="monospace">
                            override: {binding.publicHost}
                          </Text>
                        )}
                      </Stack>
                    </Group>
                    <Tooltip label="Снять с этой ноды">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        loading={
                          removeBindingMutation.isPending &&
                          removeBindingMutation.variables === binding.id
                        }
                        onClick={() => removeBindingMutation.mutate(binding.id)}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}

          {availableProfiles.length > 0 && (
            <Box mt="sm">
              <Text size="xs" c="dimmed" mb={4}>
                Quick-deploy — совместимые профили:
              </Text>
              <Group gap={6} wrap="wrap">
                {availableProfiles.map((p) => (
                  <Button
                    key={p.id}
                    variant="light"
                    size="xs"
                    leftSection={<IconLink size={12} />}
                    loading={
                      addBindingMutation.isPending &&
                      addBindingMutation.variables === p.id
                    }
                    onClick={() => addBindingMutation.mutate(p.id)}
                  >
                    {p.name}
                  </Button>
                ))}
              </Group>
            </Box>
          )}
        </Card>

        {/* Action footer */}
        <Group justify="space-between">
          <Group gap="xs">
            <Button
              variant="light"
              color="blue"
              leftSection={<IconKey size={14} />}
              loading={refreshing}
              onClick={onRefreshBootstrap}
            >
              Перевыпустить bootstrap
            </Button>
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={onDelete}
            >
              Удалить ноду
            </Button>
          </Group>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Отмена
            </Button>
            <Button onClick={handleSave} loading={saving}>
              Сохранить
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

function MetricBar({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  const color = value > 85 ? 'red' : value > 60 ? 'yellow' : 'teal';
  return (
    <Box>
      <Group gap={6} mb={2}>
        <Box style={{ color: `var(--mantine-color-${color}-5)`, display: 'flex' }}>
          {icon}
        </Box>
        <Text size="xs" fw={500} style={{ flex: 1 }}>
          {label}
        </Text>
        <Text size="xs" c="dimmed" ff="monospace">
          {detail}
        </Text>
        <Text size="xs" fw={700}>
          {value.toFixed(0)}%
        </Text>
      </Group>
      <Progress value={value} color={color} size="sm" radius="xs" />
    </Box>
  );
}

function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
