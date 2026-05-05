import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
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
import { IconEdit, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react';
import {
  createNode,
  deleteNode,
  listNodes,
  updateNode,
  type CreateNodeInput,
  type Node,
  type UpdateNodeInput,
} from '../lib/api';
import { NodeFormModal } from '../components/NodeFormModal';
import { NodePayloadModal } from '../components/NodePayloadModal';

const STATUS_COLORS: Record<string, string> = {
  online: 'green',
  unknown: 'gray',
  offline: 'red',
  unreachable: 'red',
  disabled: 'gray',
};

export function NodesPage() {
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<Node | null>(null);
  const [payload, setPayload] = useState<{ name: string; payload: string } | null>(null);

  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => listNodes({ page: 1, limit: 100 }),
  });

  const createMutation = useMutation({
    mutationFn: createNode,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['nodes'] });
      notifications.show({ color: 'green', message: 'Node created' });
      // Surface the one-time payload — the panel won't return it again.
      setPayload({ name: data.name, payload: data.payload });
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
      <Group justify="space-between">
        <Title order={2}>Nodes</Title>
        <Group>
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={() => qc.invalidateQueries({ queryKey: ['nodes'] })}
              loading={nodesQuery.isFetching}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Create node
          </Button>
        </Group>
      </Group>

      <Table.ScrollContainer minWidth={800}>
        <Table verticalSpacing="sm" highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Address</Table.Th>
              <Table.Th>Country</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th style={{ width: 1 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {nodesQuery.data?.nodes.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center" py="md">
                    No nodes yet. Click "Create node".
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {nodesQuery.data?.nodes.map((n) => (
              <Table.Tr key={n.id}>
                <Table.Td>
                  <Text fw={500}>{n.name}</Text>
                </Table.Td>
                <Table.Td>
                  <Text ff="monospace" size="sm">
                    {n.address}
                  </Text>
                </Table.Td>
                <Table.Td>{n.countryCode ?? '—'}</Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLORS[n.status] ?? 'gray'} variant="light">
                    {n.status}
                  </Badge>
                </Table.Td>
                <Table.Td>{new Date(n.createdAt).toLocaleDateString()}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" onClick={() => setEditing(n)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
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

      <NodeFormModal
        opened={createOpen}
        onClose={closeCreate}
        node={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateNodeInput);
        }}
      />

      <NodeFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        node={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
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
        />
      )}
    </Stack>
  );
}
