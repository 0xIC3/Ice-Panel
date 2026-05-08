import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconRocket, IconServer2 } from '@tabler/icons-react';
import {
  createBinding,
  deleteBinding,
  listBindings,
  listNodes,
  type Binding,
  type Node as PanelNode,
  type Profile,
} from '../lib/api';

interface Props {
  profile: Profile | null;
  onClose: () => void;
}

export function DeployProfileModal({ profile, onClose }: Props) {
  const opened = profile !== null;
  const qc = useQueryClient();

  const nodesQuery = useQuery({
    queryKey: ['nodes', 'all'],
    queryFn: () => listNodes({ limit: 100 }),
    enabled: opened,
  });

  const bindingsQuery = useQuery({
    queryKey: ['bindings', { profileId: profile?.id }],
    queryFn: () => listBindings({ profileId: profile!.id }),
    enabled: opened && profile !== null,
  });

  const initialSelected = useMemo(() => {
    const set = new Set<string>();
    for (const b of bindingsQuery.data?.bindings ?? []) {
      set.add(b.nodeId);
    }
    return set;
  }, [bindingsQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (opened) setSelected(new Set(initialSelected));
  }, [opened, initialSelected]);

  const defaultPort = useMemo(() => {
    const cfg = profile?.config as { port?: number } | undefined;
    return cfg?.port ?? 443;
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!profile) return;
      const bindings = bindingsQuery.data?.bindings ?? [];
      const byNodeId = new Map<string, Binding>();
      for (const b of bindings) byNodeId.set(b.nodeId, b);

      const toCreate: string[] = [];
      const toDelete: string[] = [];

      for (const nodeId of selected) {
        if (!byNodeId.has(nodeId)) toCreate.push(nodeId);
      }
      for (const b of bindings) {
        if (!selected.has(b.nodeId)) toDelete.push(b.id);
      }

      await Promise.all([
        ...toCreate.map((nodeId) =>
          createBinding({
            profileId: profile.id,
            nodeId,
            port: defaultPort,
          }),
        ),
        ...toDelete.map((id) => deleteBinding(id)),
      ]);

      return { created: toCreate.length, deleted: toDelete.length };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['bindings'] });
      qc.invalidateQueries({ queryKey: ['profiles'] });
      const c = result?.created ?? 0;
      const d = result?.deleted ?? 0;
      if (c === 0 && d === 0) {
        notifications.show({ color: 'gray', message: 'Изменений нет' });
      } else {
        notifications.show({
          color: 'green',
          message: `Развернут: +${c} / снят: -${d}`,
        });
      }
      onClose();
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Не получилось сохранить',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function toggle(nodeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  const nodes = nodesQuery.data?.nodes ?? [];
  const dirty = useMemo(() => {
    if (selected.size !== initialSelected.size) return true;
    for (const id of selected) if (!initialSelected.has(id)) return true;
    return false;
  }, [selected, initialSelected]);

  const loading = nodesQuery.isLoading || bindingsQuery.isLoading;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <IconRocket size={18} />
          <Text fw={600}>Развернуть «{profile?.name}» на нодах</Text>
        </Group>
      }
      size="lg"
    >
      <Stack>
        <Alert color="blue" variant="light">
          Отметь ноды, на которых нужен этот профиль. Снятые галки удаляют
          существующие bindings (cascade — пользователи теряют URL'ы для этой
          ноды). Порт по умолчанию: <b>{defaultPort}</b>. Для per-node
          override'ов (другой порт, publicHost, ACME-домен) пока используй API
          напрямую — UI будет в slice 27.5.
        </Alert>

        {loading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : nodes.length === 0 ? (
          <Text c="dimmed" ta="center" py="md">
            Нод нет — сначала создай ноду в разделе Nodes.
          </Text>
        ) : (
          <Stack gap="xs">
            {nodes.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                profileProtocol={profile?.protocol ?? null}
                checked={selected.has(node.id)}
                onToggle={() => toggle(node.id)}
              />
            ))}
          </Stack>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saveMutation.isPending}>
            Отмена
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            disabled={!dirty || loading}
            leftSection={<IconRocket size={14} />}
          >
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function NodeRow({
  node,
  profileProtocol,
  checked,
  onToggle,
}: {
  node: PanelNode;
  profileProtocol: string | null;
  checked: boolean;
  onToggle: () => void;
}) {
  const statusColor =
    node.status === 'online' ? 'teal' : node.status === 'disabled' ? 'gray' : 'red';
  // Compatibility hint: install-node.sh installs binaries for ONE protocol
  // (chosen at provisioning time). Cross-protocol binding works at the
  // panel/agent level but the agent will fall back to "callback-only mode"
  // because the protocol-server binary isn't on disk → subscription URL
  // points at a non-listening port.
  const protocolMismatch =
    profileProtocol !== null && node.protocol !== profileProtocol;
  return (
    <Paper
      withBorder
      p="sm"
      radius="sm"
      style={{
        cursor: 'pointer',
        borderColor: protocolMismatch
          ? 'var(--mantine-color-yellow-6)'
          : undefined,
      }}
      onClick={onToggle}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Checkbox checked={checked} onChange={onToggle} tabIndex={-1} />
          <IconServer2 size={16} />
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="sm" fw={500} truncate>
              {node.name}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace" truncate>
              {node.address}
            </Text>
          </Stack>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {node.countryCode && (
            <Badge variant="light" size="sm">
              {node.countryCode}
            </Badge>
          )}
          <Tooltip
            label={
              protocolMismatch
                ? `Нода провижена под "${node.protocol}" — бинарь "${profileProtocol}" не установлен. Binding создастся, но клиенты не подключатся пока не запустишь install-node заново с --protocol ${profileProtocol}.`
                : `Нода поддерживает "${node.protocol}"`
            }
            multiline
            w={280}
          >
            <Badge
              variant={protocolMismatch ? 'filled' : 'light'}
              color={protocolMismatch ? 'yellow' : 'cyan'}
              size="sm"
              tt="uppercase"
            >
              {protocolMismatch ? `⚠ ${node.protocol}` : node.protocol}
            </Badge>
          </Tooltip>
          <Tooltip label={node.lastStatusMessage ?? node.status}>
            <Badge variant="dot" color={statusColor} size="sm">
              {node.status}
            </Badge>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}
