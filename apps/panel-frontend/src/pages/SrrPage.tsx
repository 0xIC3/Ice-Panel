import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconEdit, IconBolt, IconPlus, IconRefresh, IconTrash } from '@tabler/icons-react';
import {
  createSrrRule,
  deleteSrrRule,
  listSrrRules,
  testSrrRule,
  updateSrrRule,
  type CreateSrrInput,
  type SrrRule,
  type UpdateSrrInput,
} from '../lib/api';
import { SrrFormModal } from '../components/SrrFormModal';

const FORMAT_COLORS: Record<string, string> = {
  plain: 'gray',
  json: 'gray',
  clash: 'green',
  singbox: 'blue',
  wgconf: 'teal',
  xrayjson: 'violet',
};

export function SrrPage() {
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<SrrRule | null>(null);

  const rulesQuery = useQuery({ queryKey: ['srr'], queryFn: listSrrRules });

  const createMutation = useMutation({
    mutationFn: createSrrRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['srr'] });
      notifications.show({ color: 'green', message: 'Rule created' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateSrrInput }) => updateSrrRule(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['srr'] });
      notifications.show({ color: 'green', message: 'Rule updated' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSrrRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['srr'] });
      notifications.show({ color: 'green', message: 'Rule deleted' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(rule: SrrRule) {
    modals.openConfirmModal({
      title: `Delete rule "${rule.name}"?`,
      children: <Text size="sm">This is permanent and cannot be undone from the UI.</Text>,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(rule.id),
    });
  }

  // ─── UA tester ───
  const [testUa, setTestUa] = useState('');
  const [testResult, setTestResult] = useState<{ format: string | null } | null>(null);
  const testMutation = useMutation({
    mutationFn: testSrrRule,
    onSuccess: (data) => setTestResult({ format: data.format }),
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Test failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Subscription Response Rules</Title>
        <Group>
          <Tooltip label="Refresh">
            <ActionIcon
              variant="subtle"
              size="lg"
              onClick={() => qc.invalidateQueries({ queryKey: ['srr'] })}
              loading={rulesQuery.isFetching}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            Create rule
          </Button>
        </Group>
      </Group>

      <Text c="dimmed" size="sm">
        Rules run in <Code>priority ASC</Code> order. The first rule whose regex matches the
        client's <Code>User-Agent</Code> wins. Default catch-all priority is <Code>900</Code>.
      </Text>

      <Table.ScrollContainer minWidth={800}>
        <Table verticalSpacing="sm" highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 80 }}>Priority</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>UA pattern</Table.Th>
              <Table.Th>Format</Table.Th>
              <Table.Th style={{ width: 80 }}>Enabled</Table.Th>
              <Table.Th style={{ width: 1 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rulesQuery.data?.rules.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" ta="center" py="md">
                    No rules. Create one to start auto-selecting subscription formats by UA.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {rulesQuery.data?.rules.map((r) => (
              <Table.Tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                <Table.Td>
                  <Code>{r.priority}</Code>
                </Table.Td>
                <Table.Td>
                  <Text fw={500}>{r.name}</Text>
                </Table.Td>
                <Table.Td>
                  <Code>{r.uaPattern}</Code>
                </Table.Td>
                <Table.Td>
                  <Badge color={FORMAT_COLORS[r.format] ?? 'gray'} variant="light">
                    {r.format}
                  </Badge>
                </Table.Td>
                <Table.Td>{r.enabled ? '✓' : '—'}</Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label="Edit">
                      <ActionIcon variant="subtle" onClick={() => setEditing(r)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(r)}>
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

      <Card withBorder>
        <Stack>
          <Group>
            <IconBolt size={18} />
            <Text fw={600}>Test a User-Agent</Text>
          </Group>
          <Group align="end" wrap="nowrap">
            <TextInput
              flex={1}
              placeholder="Hiddify/2.5.0 (Linux; U; Android)"
              value={testUa}
              onChange={(e) => setTestUa(e.currentTarget.value)}
            />
            <Button
              loading={testMutation.isPending}
              disabled={testUa.trim().length === 0}
              onClick={() => testMutation.mutate(testUa)}
            >
              Test
            </Button>
          </Group>
          {testResult && (
            <Text size="sm">
              {testResult.format === null ? (
                <>No rule matched — falls back to <Code>plain</Code>.</>
              ) : (
                <>
                  Matches → <Badge color={FORMAT_COLORS[testResult.format] ?? 'gray'}>{testResult.format}</Badge>
                </>
              )}
            </Text>
          )}
        </Stack>
      </Card>

      <SrrFormModal
        opened={createOpen}
        onClose={closeCreate}
        rule={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateSrrInput);
        }}
      />
      <SrrFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        rule={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({ id: editing.id, input: input as UpdateSrrInput });
        }}
      />
    </Stack>
  );
}
