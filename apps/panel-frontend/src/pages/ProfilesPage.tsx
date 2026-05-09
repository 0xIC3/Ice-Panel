import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconBolt,
  IconDotsVertical,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconRocket,
  IconSearch,
  IconServer2,
  IconTrash,
} from '@tabler/icons-react';
import {
  createProfile,
  deleteProfile,
  listBindings,
  listProfiles,
  updateProfile,
  type CreateProfileInput,
  type Profile,
  type ProtocolName,
  type UpdateProfileInput,
} from '../lib/api';
import { ProfileFormModal } from '../components/ProfileFormModal';
import { DeployProfileModal } from '../components/DeployProfileModal';
import { TestConnectModal } from '../components/TestConnectModal';

const PROTOCOL_COLORS: Record<string, string> = {
  hysteria: 'blue',
  xray: 'violet',
  amneziawg: 'teal',
  naive: 'orange',
  shadowsocks: 'pink',
  mtproto: 'cyan',
  mieru: 'grape',
};

const PROTOCOL_LABELS: Record<string, string> = {
  hysteria: 'Hysteria 2',
  xray: 'Xray REALITY',
  amneziawg: 'AmneziaWG',
  naive: 'NaiveProxy',
  shadowsocks: 'Shadowsocks',
  mtproto: 'MTProto',
  mieru: 'Mieru',
};

export function ProfilesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [deploying, setDeploying] = useState<Profile | null>(null);
  const [testing, setTesting] = useState<Profile | null>(null);
  const [search, setSearch] = useState('');
  const [protocolFilter, setProtocolFilter] = useState<ProtocolName | 'all'>('all');

  const profilesQuery = useQuery({ queryKey: ['profiles'], queryFn: () => listProfiles() });
  const bindingsQuery = useQuery({ queryKey: ['bindings'], queryFn: () => listBindings() });

  // Group bindings by profile so cards can show "deployed on: N nodes"
  // without an extra request per card.
  const bindingsByProfile = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of bindingsQuery.data?.bindings ?? []) {
      m.set(b.profileId, (m.get(b.profileId) ?? 0) + 1);
    }
    return m;
  }, [bindingsQuery.data]);

  const createMutation = useMutation({
    mutationFn: createProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['bindings'] });
      notifications.show({ color: 'green', message: t('profiles.notify.created') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.createError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProfileInput }) =>
      updateProfile(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      notifications.show({ color: 'green', message: t('profiles.notify.updated') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.saveError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProfile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['bindings'] });
      notifications.show({ color: 'green', message: t('profiles.notify.deleted') });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: t('common.deleteError'),
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(profile: Profile) {
    const bindings = bindingsByProfile.get(profile.id) ?? 0;
    modals.openConfirmModal({
      title: t('profiles.deleteTitle', { name: profile.name }),
      children: (
        <Text size="sm">
          {bindings > 0
            ? t('profiles.deleteWithBindings', { count: bindings })
            : t('profiles.deleteSafe')}
        </Text>
      ),
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(profile.id),
    });
  }

  const profiles = profilesQuery.data?.profiles ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return profiles.filter((p) => {
      if (protocolFilter !== 'all' && p.protocol !== protocolFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [profiles, search, protocolFilter]);

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={2}>
          <Title order={2}>{t('profiles.title')}</Title>
          <Text c="dimmed" size="sm">
            {t('profiles.subtitle')}
          </Text>
        </Stack>
        <Group>
          <Tooltip label={t('common.refresh')}>
            <ActionIcon
              variant="subtle"
              size="lg"
              loading={profilesQuery.isFetching}
              onClick={() => qc.invalidateQueries({ queryKey: ['profiles'] })}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Tooltip>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>
            {t('profiles.create')}
          </Button>
        </Group>
      </Group>

      <TextInput
        placeholder={t('profiles.searchPlaceholder')}
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />

      <Group gap="xs" wrap="wrap">
        <ProtocolFilterChip
          label={t('common.all')}
          color="blue"
          active={protocolFilter === 'all'}
          onClick={() => setProtocolFilter('all')}
        />
        {(Object.keys(PROTOCOL_LABELS) as ProtocolName[]).map((p) => (
          <ProtocolFilterChip
            key={p}
            label={PROTOCOL_LABELS[p]}
            color={PROTOCOL_COLORS[p] ?? 'gray'}
            active={protocolFilter === p}
            onClick={() => setProtocolFilter(p)}
          />
        ))}
      </Group>

      {filtered.length === 0 ? (
        <Card withBorder padding="xl" radius="md">
          <Stack align="center" gap="sm">
            <ThemeIcon size={48} radius="md" variant="light" color="gray">
              <IconBolt size={24} />
            </ThemeIcon>
            <Text c="dimmed" size="sm">
              {profiles.length === 0
                ? t('profiles.emptyAll')
                : t('profiles.emptyFiltered')}
            </Text>
          </Stack>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="md">
          {filtered.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              bindingCount={bindingsByProfile.get(p.id) ?? p.bindingCount}
              onEdit={() => setEditing(p)}
              onDelete={() => handleDelete(p)}
              onDeploy={() => setDeploying(p)}
              onTest={() => setTesting(p)}
            />
          ))}
        </SimpleGrid>
      )}

      <ProfileFormModal
        opened={createOpen}
        onClose={closeCreate}
        profile={null}
        loading={createMutation.isPending}
        onSubmit={async (input) => {
          await createMutation.mutateAsync(input as CreateProfileInput);
        }}
      />
      <ProfileFormModal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        profile={editing}
        loading={updateMutation.isPending}
        onSubmit={async (input) => {
          if (!editing) return;
          await updateMutation.mutateAsync({
            id: editing.id,
            input: input as UpdateProfileInput,
          });
        }}
      />

      <DeployProfileModal
        profile={deploying}
        onClose={() => setDeploying(null)}
      />
      <TestConnectModal
        profile={testing}
        onClose={() => setTesting(null)}
      />
    </Stack>
  );
}

function ProtocolFilterChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Badge
      variant={active ? 'filled' : 'light'}
      color={color}
      style={{ cursor: 'pointer', textTransform: 'none' }}
      size="lg"
      onClick={onClick}
    >
      {label}
    </Badge>
  );
}

function ProfileCard({
  profile,
  bindingCount,
  onEdit,
  onDelete,
  onDeploy,
  onTest,
}: {
  profile: Profile;
  bindingCount: number;
  onEdit: () => void;
  onDelete: () => void;
  onDeploy: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  const color = PROTOCOL_COLORS[profile.protocol] ?? 'gray';
  return (
    <Card
      withBorder
      padding="md"
      radius="md"
      style={{
        borderTopWidth: 3,
        borderTopColor: `var(--mantine-color-${color}-6)`,
        opacity: profile.enabled ? 1 : 0.65,
      }}
    >
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="md">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size={36} radius="md" variant="light" color={color}>
            <IconBolt size={18} />
          </ThemeIcon>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={700} size="sm" truncate>
              {profile.name}
            </Text>
            {profile.description && (
              <Text size="xs" c="dimmed" lineClamp={1}>
                {profile.description}
              </Text>
            )}
          </Stack>
        </Group>
        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" size="sm">
              <IconDotsVertical size={14} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconRocket size={14} />} onClick={onDeploy}>
              {t('profiles.deployToNodes')}
            </Menu.Item>
            <Menu.Item leftSection={<IconBolt size={14} />} onClick={onTest}>
              Test connect
            </Menu.Item>
            <Menu.Item leftSection={<IconEdit size={14} />} onClick={onEdit}>
              {t('common.edit')}
            </Menu.Item>
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={onDelete}>
              {t('common.delete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>

      <Group gap="xs" mb="md">
        <Badge variant="light" color={color} size="sm" tt="uppercase">
          {profile.protocol}
        </Badge>
        <Tooltip label={bindingCount === 0 ? t('profiles.bindingsTooltipNone') : t('profiles.bindingsTooltipDeployed')}>
          <Badge
            variant={bindingCount === 0 ? 'outline' : 'filled'}
            color={bindingCount === 0 ? 'gray' : 'teal'}
            size="sm"
            leftSection={<IconServer2 size={11} />}
            style={{ cursor: 'pointer' }}
            onClick={onDeploy}
          >
            {bindingCount}
          </Badge>
        </Tooltip>
        {!profile.enabled && (
          <Badge variant="default" color="gray" size="sm">
            off
          </Badge>
        )}
      </Group>

      <Button
        variant="light"
        color={color}
        fullWidth
        leftSection={<IconRocket size={14} />}
        onClick={onDeploy}
      >
        {t('profiles.deployToNodes')}
      </Button>
    </Card>
  );
}
