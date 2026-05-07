import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
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
import { IconEdit, IconPlus, IconRefresh, IconShieldLock, IconTrash } from '@tabler/icons-react';
import {
  ALL_SQUAD_ID,
  createSquad,
  deleteSquad,
  listInbounds,
  listSquads,
  updateSquad,
  type CreateSquadInput,
  type Squad,
  type UpdateSquadInput,
} from '../lib/api';
import { SquadFormModal } from '../components/SquadFormModal';

export function SquadsPage() {
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<Squad | null>(null);

  const squadsQuery = useQuery({ queryKey: ['squads'], queryFn: listSquads });
  const inboundsQuery = useQuery({ queryKey: ['inbounds'], queryFn: listInbounds });

  const createMutation = useMutation({
    mutationFn: createSquad,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['squads'] });
      notifications.show({ color: 'green', message: 'Squad created' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSquadInput }) =>
      updateSquad(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['squads'] });
      notifications.show({ color: 'green', message: 'Squad updated' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSquad,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['squads'] });
      notifications.show({ color: 'green', message: 'Squad deleted' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleCreate(input: CreateSquadInput | UpdateSquadInput): Promise<void> {
    return createMutation.mutateAsync(input as CreateSquadInput).then(() => undefined);
  }

  function handleUpdate(input: CreateSquadInput | UpdateSquadInput): Promise<void> {
    if (!editing) return Promise.resolve();
    return updateMutation
      .mutateAsync({ id: editing.id, input: input as UpdateSquadInput })
      .then(() => undefined);
  }

  function handleDelete(squad: Squad) {
    modals.openConfirmModal({
      title: `Delete squad "${squad.name}"?`,
      children: (
        <Text size="sm">
          {squad.memberCount > 0
            ? `${squad.memberCount} user(s) belong to this squad. Members who have no other squad will fall through to "All".`
            : 'No members will be affected.'}
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(squad.id),
    });
  }

  const squads = squadsQuery.data?.squads ?? [];
  const inbounds = inboundsQuery.data?.inbounds ?? [];
  const inboundById = new Map(inbounds.map((ib) => [ib.id, ib]));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Squads</Title>
        <Group>
          <Tooltip label="Refresh">
            <ActionIcon
              variant="light"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: ['squads'] });
              }}
            >
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Create squad
          </Button>
        </Group>
      </Group>

      <Card withBorder>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th>Inbounds</Table.Th>
              <Table.Th>Members</Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {squads.map((squad) => {
              const isAll = squad.id === ALL_SQUAD_ID;
              return (
                <Table.Tr key={squad.id}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      {isAll ? (
                        <Tooltip label="System-managed — auto-tracks every inbound">
                          <IconShieldLock size={14} />
                        </Tooltip>
                      ) : null}
                      <Text fw={500}>{squad.name}</Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text c="dimmed" size="sm">
                      {squad.description ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="wrap">
                      {squad.inboundIds.length === 0 ? (
                        <Text c="dimmed" size="sm">
                          —
                        </Text>
                      ) : (
                        squad.inboundIds.slice(0, 6).map((id) => {
                          const ib = inboundById.get(id);
                          return (
                            <Badge key={id} variant="light" size="sm">
                              {ib ? `${ib.name}:${ib.port}` : id.slice(0, 8)}
                            </Badge>
                          );
                        })
                      )}
                      {squad.inboundIds.length > 6 ? (
                        <Badge variant="light" size="sm" color="gray">
                          +{squad.inboundIds.length - 6}
                        </Badge>
                      ) : null}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light" color={squad.memberCount > 0 ? 'blue' : 'gray'}>
                      {squad.memberCount}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      <Tooltip label={isAll ? 'View (read-only)' : 'Edit'}>
                        <ActionIcon variant="subtle" onClick={() => setEditing(squad)}>
                          <IconEdit size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={isAll ? 'System squad — cannot delete' : 'Delete'}>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          disabled={isAll}
                          onClick={() => handleDelete(squad)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {squads.length === 0 && !squadsQuery.isLoading ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text c="dimmed" ta="center" py="md">
                    No squads yet. (The "All" squad is auto-seeded by migration —
                    check that you've applied{' '}
                    <Text component="code">prisma migrate deploy</Text>.)
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : null}
          </Table.Tbody>
        </Table>
      </Card>

      <SquadFormModal
        opened={createOpen}
        onClose={closeCreate}
        squad={null}
        inbounds={inbounds}
        onSubmit={handleCreate}
        loading={createMutation.isPending}
      />

      <SquadFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        squad={editing}
        inbounds={inbounds}
        onSubmit={handleUpdate}
        loading={updateMutation.isPending}
      />
    </Stack>
  );
}
