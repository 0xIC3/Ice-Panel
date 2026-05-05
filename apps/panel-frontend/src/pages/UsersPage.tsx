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
import { copyToClipboard } from '../lib/clipboard';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconCheck,
  IconCopy,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import {
  createUser,
  deleteUser,
  listUsers,
  subscriptionUrl,
  updateUser,
  type CreateUserInput,
  type UpdateUserInput,
  type User,
} from '../lib/api';
import { UserFormModal } from '../components/UserFormModal';

function SubscriptionCopyIcon({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    try {
      await copyToClipboard(url);
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
    <Tooltip label={copied ? 'Copied' : 'Copy subscription URL'}>
      <ActionIcon variant="subtle" color={copied ? 'green' : undefined} onClick={handleCopy}>
        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
      </ActionIcon>
    </Tooltip>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: 'green',
  disabled: 'gray',
  expired: 'red',
  limited: 'yellow',
};

const PROTOCOL_COLORS: Record<string, string> = {
  hysteria: 'blue',
  xray: 'violet',
  amneziawg: 'teal',
  naive: 'orange',
};

const GB = 1_073_741_824;

function formatTraffic(used: number, limit: number | null): string {
  const u = (used / GB).toFixed(2);
  if (limit === null) return `${u} / ∞ GB`;
  return `${u} / ${(limit / GB).toFixed(0)} GB`;
}

function formatExpire(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

export function UsersPage() {
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<User | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers({ page: 1, limit: 100 }),
  });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: 'User created' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) => updateUser(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: 'User updated' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      notifications.show({ color: 'green', message: 'User deleted' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(user: User) {
    modals.openConfirmModal({
      title: `Delete user "${user.username}"?`,
      children: (
        <Text size="sm">
          The user will be soft-deleted and removed from all nodes. This cannot be undone from the UI.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(user.id),
    });
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Users</Title>
        <Group>
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={() => qc.invalidateQueries({ queryKey: ['users'] })}
              loading={usersQuery.isFetching}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Create user
          </Button>
        </Group>
      </Group>

      <Table.ScrollContainer minWidth={900}>
        <Table verticalSpacing="sm" highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Username</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Traffic</Table.Th>
              <Table.Th>Strategy</Table.Th>
              <Table.Th>Protocols</Table.Th>
              <Table.Th>Expires</Table.Th>
              <Table.Th>Tag</Table.Th>
              <Table.Th style={{ width: 1 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {usersQuery.data?.users.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={8}>
                  <Text c="dimmed" ta="center" py="md">
                    No users yet. Click "Create user".
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {usersQuery.data?.users.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td>
                  <Text fw={500}>{u.username}</Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    {u.shortId}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLORS[u.status] ?? 'gray'} variant="light">
                    {u.status}
                  </Badge>
                </Table.Td>
                <Table.Td>{formatTraffic(u.trafficUsedBytes, u.trafficLimitBytes)}</Table.Td>
                <Table.Td>{u.trafficLimitStrategy}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="wrap">
                    {u.enabledProtocols.map((p) => (
                      <Badge key={p} color={PROTOCOL_COLORS[p] ?? 'gray'} variant="light" size="sm">
                        {p}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>
                <Table.Td>{formatExpire(u.expireAt)}</Table.Td>
                <Table.Td>{u.tag ?? '—'}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <SubscriptionCopyIcon url={subscriptionUrl(u.subscriptionToken)} />
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" onClick={() => setEditing(u)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(u)}>
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

      <UserFormModal
        opened={createOpen}
        onClose={closeCreate}
        user={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateUserInput);
        }}
      />

      <UserFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        user={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input: input as UpdateUserInput });
        }}
      />
    </Stack>
  );
}
