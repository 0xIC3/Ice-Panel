import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Code,
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
  createInbound,
  deleteInbound,
  listInbounds,
  listNodes,
  updateInbound,
  type CreateInboundInput,
  type Inbound,
  type UpdateInboundInput,
} from '../lib/api';
import { InboundFormModal } from '../components/InboundFormModal';

const PROTOCOL_COLORS: Record<string, string> = {
  hysteria: 'blue',
  xray: 'violet',
  amneziawg: 'teal',
  naive: 'orange',
};

export function InboundsPage() {
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<Inbound | null>(null);

  const inboundsQuery = useQuery({ queryKey: ['inbounds'], queryFn: listInbounds });
  const nodesQuery = useQuery({
    queryKey: ['nodes'],
    queryFn: () => listNodes({ page: 1, limit: 100 }),
  });

  const createMutation = useMutation({
    mutationFn: createInbound,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbounds'] });
      notifications.show({ color: 'green', message: 'Inbound created' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateInboundInput }) => updateInbound(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbounds'] });
      notifications.show({ color: 'green', message: 'Inbound updated' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteInbound,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inbounds'] });
      notifications.show({ color: 'green', message: 'Inbound deleted' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(ib: Inbound) {
    modals.openConfirmModal({
      title: `Delete inbound "${ib.name}"?`,
      children: (
        <Text size="sm">
          Active client sessions on this inbound will be dropped at the next user mutation. This
          cannot be undone from the UI.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(ib.id),
    });
  }

  const nodeNameById = new Map(nodesQuery.data?.nodes.map((n) => [n.id, n.name]) ?? []);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Inbounds</Title>
        <Group>
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={() => qc.invalidateQueries({ queryKey: ['inbounds'] })}
              loading={inboundsQuery.isFetching}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={openCreate}
            disabled={(nodesQuery.data?.nodes.length ?? 0) === 0}
          >
            Create inbound
          </Button>
        </Group>
      </Group>

      {(nodesQuery.data?.nodes.length ?? 0) === 0 && (
        <Text c="dimmed" size="sm">
          No nodes yet - create a Node first, then attach inbounds to it.
        </Text>
      )}

      <Table.ScrollContainer minWidth={900}>
        <Table verticalSpacing="sm" highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Node</Table.Th>
              <Table.Th>Protocol</Table.Th>
              <Table.Th style={{ width: 90 }}>Port</Table.Th>
              <Table.Th style={{ width: 90 }}>Enabled</Table.Th>
              <Table.Th style={{ width: 1 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {inboundsQuery.data?.inbounds.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center" py="md">
                    No inbounds yet. Click "Create inbound".
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {inboundsQuery.data?.inbounds.map((ib) => (
              <Table.Tr key={ib.id} style={{ opacity: ib.enabled ? 1 : 0.5 }}>
                <Table.Td>
                  <Text fw={500}>{ib.name}</Text>
                </Table.Td>
                <Table.Td>{nodeNameById.get(ib.nodeId) ?? <Code>{ib.nodeId.slice(0, 8)}</Code>}</Table.Td>
                <Table.Td>
                  <Badge color={PROTOCOL_COLORS[ib.protocol] ?? 'gray'} variant="light">
                    {ib.protocol}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Code>{ib.port}</Code>
                </Table.Td>
                <Table.Td>
                  <Badge color={ib.enabled ? 'green' : 'gray'} variant="light">
                    {ib.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" onClick={() => setEditing(ib)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(ib)}>
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

      <InboundFormModal
        opened={createOpen}
        onClose={closeCreate}
        inbound={null}
        nodes={nodesQuery.data?.nodes ?? []}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateInboundInput);
        }}
      />
      <InboundFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        inbound={editing}
        nodes={nodesQuery.data?.nodes ?? []}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input: input as UpdateInboundInput });
        }}
      />
    </Stack>
  );
}
