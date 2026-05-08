import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconEdit,
  IconKey,
  IconLayoutGrid,
  IconLayoutList,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import {
  createBinding,
  createNode,
  deleteNode,
  getDashboardOverview,
  listNodes,
  refreshNodeBootstrap,
  updateNode,
  type CreateNodeInput,
  type Node,
  type UpdateNodeInput,
} from '../lib/api';
import { NodeFormModal } from '../components/NodeFormModal';
import { NodePayloadModal } from '../components/NodePayloadModal';
import { NodeCard } from '../components/NodeCard';
import { countryFlag } from '../lib/countries';

const STATUS_COLORS: Record<string, string> = {
  online: 'green',
  unknown: 'gray',
  offline: 'red',
  unreachable: 'red',
  disabled: 'gray',
};

function formatBytes(n: number): string {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log2(Math.max(1, n)) / 10), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

type LayoutMode = 'cards' | 'compact';
const LAYOUT_KEY = 'ice-panel:nodes-layout';

export function NodesPage() {
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<Node | null>(null);
  const [payload, setPayload] = useState<{
    name: string;
    payload: string;
    bootstrap?: { token: string; expiresAt: string; command: string };
  } | null>(null);
  const [layout, setLayout] = useState<LayoutMode>(
    (typeof window !== 'undefined' &&
      (window.localStorage.getItem(LAYOUT_KEY) as LayoutMode | null)) ||
      'cards',
  );
  function setLayoutPersist(m: LayoutMode) {
    setLayout(m);
    if (typeof window !== 'undefined') window.localStorage.setItem(LAYOUT_KEY, m);
  }

  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => listNodes({ page: 1, limit: 100 }),
  });

  // Pull live metrics from dashboard endpoint — already provides cpu/ram/disk
  // per node + today's traffic + inboundCount. Refetch every 15s to keep
  // cards in sync with the agent metrics-poll cron.
  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: getDashboardOverview,
    refetchInterval: 15_000,
  });

  // Merge raw nodes (canonical source for actions / address) with dashboard
  // metrics (CPU/RAM/disk/today). Indexed by id for O(1) join.
  const enrichedNodes = useMemo(() => {
    const overviewById = new Map(
      (overviewQuery.data?.nodes ?? []).map((n) => [n.id, n]),
    );
    return (nodesQuery.data?.nodes ?? []).map((n) => ({
      ...n,
      overview: overviewById.get(n.id) ?? null,
    }));
  }, [nodesQuery.data, overviewQuery.data]);

  const createMutation = useMutation({
    mutationFn: createNode,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: 'Node created' });
      // Surface the one-time payload + bootstrap token — neither is shown
      // by the panel on subsequent reads.
      setPayload({
        name: data.name,
        payload: data.payload,
        bootstrap: data.bootstrap,
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateNodeInput }) => updateNode(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: 'Node updated' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: 'Node deleted' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  // Re-issue a bootstrap token for an existing node — used when the original
  // expired / was lost, or when admin changed `node.address` and needs a new
  // cert with the matching SAN. Reuses the same NodePayloadModal as the create
  // flow, but `payload` stays empty (panel never re-emits the cert payload —
  // only the install command + token).
  const refreshBootstrapMutation = useMutation({
    mutationFn: (node: Node) =>
      refreshNodeBootstrap(node.id).then((info) => ({ node, info })),
    onSuccess: ({ node, info }) => {
      notifications.show({ color: 'green', message: 'New bootstrap token issued' });
      setPayload({
        name: node.name,
        payload: '',
        bootstrap: info,
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Refresh bootstrap failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(node: Node) {
    modals.openConfirmModal({
      title: `Delete node "${node.name}"?`,
      children: (
        <Text size="sm">
          The node will be soft-deleted. Existing users stop being synced to it. The mTLS payload
          you saved will no longer be valid; provisioning a replacement requires a new node.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(node.id),
    });
  }

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>Ноды</Title>
          <Text c="dimmed" size="sm">
            {enrichedNodes.length} {enrichedNodes.length === 1 ? 'нода' : 'нод'} ·
            {' '}
            {enrichedNodes.filter((n) => n.status === 'online').length} онлайн
          </Text>
        </Stack>
        <Group>
          <SegmentedControl
            size="xs"
            value={layout}
            onChange={(v) => setLayoutPersist(v as LayoutMode)}
            data={[
              {
                value: 'cards',
                label: (
                  <Group gap={4} wrap="nowrap">
                    <IconLayoutGrid size={12} />
                    <Text size="xs">Карточки</Text>
                  </Group>
                ),
              },
              {
                value: 'compact',
                label: (
                  <Group gap={4} wrap="nowrap">
                    <IconLayoutList size={12} />
                    <Text size="xs">Список</Text>
                  </Group>
                ),
              },
            ]}
          />
          <Tooltip label="Обновить">
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={() => {
                qc.invalidateQueries({ queryKey: ['nodes'] });
                qc.invalidateQueries({ queryKey: ['dashboard'] });
              }}
              loading={nodesQuery.isFetching || overviewQuery.isFetching}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Создать ноду
          </Button>
        </Group>
      </Group>

      {enrichedNodes.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          Нод ещё нет. Жми «Создать ноду».
        </Text>
      ) : layout === 'cards' ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="md">
          {enrichedNodes.map((n) => {
            // Synthesise a DashboardNode shape if metrics haven't arrived yet —
            // card still renders with status from /api/nodes, just shows
            // metrics placeholder.
            const dashNode = n.overview ?? {
              id: n.id,
              name: n.name,
              status: n.status,
              countryCode: n.countryCode,
              lastStatusChange: n.lastStatusChange,
              inboundCount: 0,
              todayBytes: 0,
              metrics: null,
            };
            return (
              <NodeCard
                key={n.id}
                node={{ ...dashNode, rawId: n.id }}
                onEdit={() => setEditing(n)}
                onDelete={() => handleDelete(n)}
                onRefreshBootstrap={() => refreshBootstrapMutation.mutate(n)}
                refreshLoading={
                  refreshBootstrapMutation.isPending &&
                  refreshBootstrapMutation.variables?.id === n.id
                }
              />
            );
          })}
        </SimpleGrid>
      ) : (
        <Table.ScrollContainer minWidth={800}>
          <Table verticalSpacing="sm" highlightOnHover withTableBorder>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Address</Table.Th>
                <Table.Th>Country</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Bindings</Table.Th>
                <Table.Th>Сегодня</Table.Th>
                <Table.Th style={{ width: 1 }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {enrichedNodes.map((n) => (
                <Table.Tr key={n.id}>
                  <Table.Td>
                    <Text fw={500}>{n.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text ff="monospace" size="sm">
                      {n.address}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {n.countryCode ? (
                      <Group gap={4} wrap="nowrap">
                        <Text>{countryFlag(n.countryCode)}</Text>
                        <Text size="sm">{n.countryCode}</Text>
                      </Group>
                    ) : (
                      <Text c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLORS[n.status] ?? 'gray'} variant="light">
                      {n.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{n.overview?.inboundCount ?? 0}</Table.Td>
                  <Table.Td>
                    {n.overview ? formatBytes(n.overview.todayBytes) : '—'}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Перевыпустить bootstrap">
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          loading={
                            refreshBootstrapMutation.isPending &&
                            refreshBootstrapMutation.variables?.id === n.id
                          }
                          onClick={() => refreshBootstrapMutation.mutate(n)}
                        >
                          <IconKey size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Редактировать">
                        <ActionIcon variant="subtle" onClick={() => setEditing(n)}>
                          <IconEdit size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Удалить">
                        <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(n)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <NodeFormModal
        opened={createOpen}
        onClose={closeCreate}
        node={null}
        loading={createMutation.isPending}
        onSubmit={async (input, profileIds) => {
          // Step 1: register the node and get its ID. Bootstrap modal opens
          // automatically via createMutation.onSuccess.
          const created = await createMutation.mutateAsync(input as CreateNodeInput);
          // Step 2: auto-create bindings for each picked profile. Done in
          // sequence (low volume — admin won't pick 50 profiles at once)
          // and tolerant — one binding failure doesn't block the rest.
          if (profileIds.length > 0) {
            const ok: string[] = [];
            const fail: string[] = [];
            for (const profileId of profileIds) {
              try {
                await createBinding({ profileId, nodeId: created.id, port: 443 });
                ok.push(profileId);
              } catch {
                fail.push(profileId);
              }
            }
            qc.invalidateQueries({ queryKey: ['bindings'] });
            qc.invalidateQueries({ queryKey: ['profiles'] });
            if (fail.length > 0) {
              notifications.show({
                color: 'yellow',
                title: 'Часть bindings не создалась',
                message: `Привязано: ${ok.length}, упало: ${fail.length}. Попробуй вручную через карточку Profile.`,
              });
            } else {
              notifications.show({
                color: 'green',
                message: `Нода создана + ${ok.length} bindings`,
              });
            }
          }
        }}
      />

      <NodeFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        node={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          // Edit mode: bindings are managed via DeployProfileModal on the
          // profile card, not here. The wizard's step 2 still renders but
          // selections are ignored on this branch.
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input: input as UpdateNodeInput });
        }}
      />

      {payload && (
        <NodePayloadModal
          opened={true}
          onClose={() => setPayload(null)}
          nodeName={payload.name}
          payload={payload.payload}
          bootstrap={payload.bootstrap}
        />
      )}
    </Stack>
  );
}
