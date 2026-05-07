import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
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
  IconBrandGithub,
  IconBrandTelegram,
  IconCheck,
  IconCopy,
  IconKey,
  IconLock,
  IconPalette,
  IconPlus,
  IconRefresh,
  IconShield,
  IconTrash,
  IconUserCircle,
} from '@tabler/icons-react';
import { copyToClipboard } from '../lib/clipboard';
import {
  createApiToken,
  deleteApiToken,
  listApiTokens,
  type ApiToken,
} from '../lib/api';

const BRAND_NAME_KEY = 'ice-panel:brandName';

export function SettingsPage() {
  return (
    <Stack gap="lg">
      <Stack gap={2}>
        <Title order={2}>Настройки</Title>
        <Text c="dimmed" size="sm">
          Аутентификация, API-токены, кастомизация
        </Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <AuthMethodsCard />
        <ApiTokensCard />
      </SimpleGrid>

      <CustomizationCard />
    </Stack>
  );
}

// ───── Auth methods ─────

interface AuthMethod {
  id: string;
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
  comingSoon?: boolean;
  hint?: string;
}

const AUTH_METHODS: AuthMethod[] = [
  {
    id: 'password',
    label: 'Пароль',
    icon: <IconLock size={16} />,
    enabled: true,
    hint: 'Логин по username + password — основной метод',
  },
  {
    id: 'passkey',
    label: 'Passkey',
    icon: <IconKey size={16} />,
    enabled: false,
    comingSoon: true,
    hint: 'WebAuthn / FIDO2 — Phase 3',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    icon: <IconBrandTelegram size={16} />,
    enabled: false,
    comingSoon: true,
    hint: 'Telegram OAuth login widget',
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: <IconBrandGithub size={16} />,
    enabled: false,
    comingSoon: true,
  },
  {
    id: 'oauth2',
    label: 'Generic OAuth2',
    icon: <IconShield size={16} />,
    enabled: false,
    comingSoon: true,
  },
];

function AuthMethodsCard() {
  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="sm" mb="md">
        <ThemeIcon size={32} radius="md" variant="light" color="blue">
          <IconUserCircle size={18} />
        </ThemeIcon>
        <Stack gap={0}>
          <Text fw={600}>Способы аутентификации</Text>
          <Text size="xs" c="dimmed">
            Управление способами входа в панель
          </Text>
        </Stack>
      </Group>

      <Stack gap="xs">
        {AUTH_METHODS.map((m) => (
          <Paper key={m.id} withBorder p="sm" radius="sm">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <ThemeIcon
                  size="sm"
                  variant="light"
                  color={m.enabled ? 'teal' : 'gray'}
                >
                  {m.icon}
                </ThemeIcon>
                <Stack gap={0} style={{ minWidth: 0 }}>
                  <Group gap={6}>
                    <Text size="sm" fw={500}>
                      {m.label}
                    </Text>
                    {m.comingSoon && (
                      <Badge size="xs" variant="light" color="gray">
                        soon
                      </Badge>
                    )}
                  </Group>
                  {m.hint && (
                    <Text size="xs" c="dimmed">
                      {m.hint}
                    </Text>
                  )}
                </Stack>
              </Group>
              <Tooltip
                label={
                  m.id === 'password'
                    ? 'Базовый метод — отключить нельзя пока не настроен другой'
                    : m.comingSoon
                      ? 'Coming soon'
                      : ''
                }
              >
                <Switch checked={m.enabled} disabled readOnly />
              </Tooltip>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Card>
  );
}

// ───── API tokens ─────

function ApiTokensCard() {
  const qc = useQueryClient();
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const tokensQuery = useQuery({
    queryKey: ['api-tokens'],
    queryFn: listApiTokens,
  });

  const createMutation = useMutation({
    mutationFn: createApiToken,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      setRevealed(created.token);
      closeCreate();
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Не получилось создать',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteApiToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      notifications.show({ color: 'green', message: 'Токен удалён' });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Не получилось удалить',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function handleDelete(token: ApiToken) {
    modals.openConfirmModal({
      title: `Удалить токен «${token.name}»?`,
      children: (
        <Text size="sm">
          Существующие интеграции, использующие этот токен, перестанут работать.
          Действие необратимо.
        </Text>
      ),
      labels: { confirm: 'Удалить', cancel: 'Отмена' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteMutation.mutate(token.id),
    });
  }

  const tokens = tokensQuery.data?.tokens ?? [];

  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" mb="md" wrap="nowrap">
        <Group gap="sm">
          <ThemeIcon size={32} radius="md" variant="light" color="violet">
            <IconKey size={18} />
          </ThemeIcon>
          <Stack gap={0}>
            <Text fw={600}>API-токены</Text>
            <Text size="xs" c="dimmed">
              Bearer-токены для интеграций (бот, скрипты)
            </Text>
          </Stack>
        </Group>
        <Tooltip label="Обновить">
          <ActionIcon
            variant="subtle"
            size="sm"
            loading={tokensQuery.isFetching}
            onClick={() => qc.invalidateQueries({ queryKey: ['api-tokens'] })}
          >
            <IconRefresh size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {tokens.length === 0 ? (
        <Text c="dimmed" size="sm" py="md" ta="center">
          Токенов ещё нет. Нажми «Создать» — выпустится новый.
        </Text>
      ) : (
        <Stack gap="xs">
          {tokens.map((t) => (
            <Paper key={t.id} withBorder p="sm" radius="sm">
              <Group justify="space-between" wrap="nowrap">
                <Stack gap={0}>
                  <Text size="sm" fw={500}>
                    {t.name}
                  </Text>
                  <Text size="xs" c="dimmed" ff="monospace">
                    создан {new Date(t.createdAt).toLocaleString()}
                    {t.lastUsedAt
                      ? ` · использовался ${new Date(t.lastUsedAt).toLocaleString()}`
                      : ' · ни разу не использовался'}
                  </Text>
                </Stack>
                <Tooltip label="Удалить">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={() => handleDelete(t)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      <Button
        mt="md"
        variant="light"
        leftSection={<IconPlus size={14} />}
        onClick={openCreate}
        fullWidth
      >
        Создать токен
      </Button>

      <CreateApiTokenModal
        opened={createOpen}
        onClose={closeCreate}
        loading={createMutation.isPending}
        onSubmit={(name) => createMutation.mutate({ name })}
      />

      <RevealTokenModal
        token={revealed}
        onClose={() => setRevealed(null)}
      />
    </Card>
  );
}

function CreateApiTokenModal({
  opened,
  onClose,
  onSubmit,
  loading,
}: {
  opened: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  loading: boolean;
}) {
  const [name, setName] = useState('');
  return (
    <Modal opened={opened} onClose={onClose} title="Новый API-токен" size="md">
      <Stack>
        <TextInput
          label="Имя"
          placeholder="telegram-bot / ci-deploy / ..."
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          autoFocus
        />
        <Alert color="yellow" variant="light">
          После создания плейнтекст-токен будет показан <b>один раз</b> — скопируй
          его сразу. Панель хранит только SHA-256 hash и больше плейнтекст не
          вернёт.
        </Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={loading}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              if (name.trim().length === 0) return;
              onSubmit(name.trim());
              setName('');
            }}
            loading={loading}
            disabled={name.trim().length === 0}
          >
            Создать
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RevealTokenModal({
  token,
  onClose,
}: {
  token: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!token) return;
    await copyToClipboard(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Modal
      opened={token !== null}
      onClose={onClose}
      title="Токен создан"
      size="md"
      withCloseButton
    >
      <Stack>
        <Alert color="yellow" variant="light">
          Скопируй токен <b>сейчас</b> — после закрытия окна панель его больше не
          покажет.
        </Alert>
        <Code
          block
          style={{
            fontSize: 12,
            wordBreak: 'break-all',
            cursor: 'pointer',
          }}
          onClick={copy}
        >
          {token}
        </Code>
        <Group justify="flex-end">
          <Button
            variant="light"
            leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            onClick={copy}
            color={copied ? 'teal' : undefined}
          >
            {copied ? 'Скопировано' : 'Скопировать'}
          </Button>
          <Button onClick={onClose}>Готово</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ───── Customization ─────

function CustomizationCard() {
  const initial = typeof window !== 'undefined'
    ? window.localStorage.getItem(BRAND_NAME_KEY) ?? 'Ice-Panel'
    : 'Ice-Panel';
  const [brandName, setBrandName] = useState(initial);
  const [saving, setSaving] = useState(false);

  function save() {
    setSaving(true);
    window.localStorage.setItem(BRAND_NAME_KEY, brandName.trim() || 'Ice-Panel');
    notifications.show({
      color: 'green',
      message: 'Сохранено локально (браузер) — для централизации нужен backend',
    });
    setSaving(false);
  }

  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="sm" mb="md">
        <ThemeIcon size={32} radius="md" variant="light" color="grape">
          <IconPalette size={18} />
        </ThemeIcon>
        <Stack gap={0}>
          <Text fw={600}>Кастомизация</Text>
          <Text size="xs" c="dimmed">
            Бренд и оформление панели (на этом этапе хранится в localStorage)
          </Text>
        </Stack>
      </Group>

      <Stack gap="sm" maw={500}>
        <TextInput
          label="Название бренда"
          description="Заголовок страницы входа"
          value={brandName}
          onChange={(e) => setBrandName(e.currentTarget.value)}
          placeholder="Ice-Panel"
        />
        <Group justify="flex-end">
          <Button onClick={save} loading={saving} leftSection={<IconCheck size={14} />}>
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
