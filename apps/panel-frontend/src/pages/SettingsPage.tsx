import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Modal,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
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
  IconRss,
  IconShield,
  IconTrash,
  IconUserCircle,
} from '@tabler/icons-react';
import { copyToClipboard } from '../lib/clipboard';
import {
  createApiToken,
  deleteApiToken,
  listApiTokens,
  getSettings,
  updateSettings,
  type ApiToken,
} from '../lib/api';

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
      <SubscriptionMetadataCard />
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
                <Group gap={4} wrap="nowrap">
                  <Tooltip label="Скопировать ID">
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={async () => {
                        await copyToClipboard(t.id);
                        notifications.show({
                          color: 'teal',
                          message: 'ID скопирован',
                          autoClose: 1500,
                        });
                      }}
                    >
                      <IconCopy size={14} />
                    </ActionIcon>
                  </Tooltip>
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
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['settings', 'all'],
    queryFn: getSettings,
  });
  const [brandName, setBrandName] = useState('');

  // Hydrate local edit state once when the server value lands.
  useEffect(() => {
    if (settingsQuery.data?.brandName && brandName === '') {
      setBrandName(settingsQuery.data.brandName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: { brandName: string }) => updateSettings(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notifications.show({
        color: 'green',
        message: 'Сохранено — обновится у всех админов после refresh',
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Не получилось сохранить',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function save() {
    const trimmed = brandName.trim() || 'Ice-Panel';
    saveMutation.mutate({ brandName: trimmed });
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
            Бренд и оформление панели — хранится централизованно в БД
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
          <Button
            onClick={save}
            loading={saveMutation.isPending}
            disabled={settingsQuery.isLoading}
            leftSection={<IconCheck size={14} />}
          >
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

// ───── Subscription metadata (slice S1) ─────

/**
 * Admin-facing editor for the headers `/sub/:token` emits to client apps —
 * Profile-Title (display name), Profile-Update-Interval (refresh cadence),
 * Support-URL, and an Announce template with `{{TRAFFIC_LEFT}}`,
 * `{{DAYS_LEFT}}`, `{{SUPPORT_URL}}` placeholders rendered per request.
 *
 * Subscription-Userinfo (quota gauge) is auto-emitted from user state —
 * not configurable here.
 */
function SubscriptionMetadataCard() {
  const qc = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['settings', 'all'],
    queryFn: getSettings,
  });

  const [profileTitle, setProfileTitle] = useState('');
  const [intervalHours, setIntervalHours] = useState<number | ''>(24);
  const [supportUrl, setSupportUrl] = useState('');
  const [announceTemplate, setAnnounceTemplate] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!hydrated && settingsQuery.data) {
      setProfileTitle(settingsQuery.data.subscriptionProfileTitle ?? '');
      setIntervalHours(settingsQuery.data.subscriptionUpdateIntervalHours ?? 24);
      setSupportUrl(settingsQuery.data.subscriptionSupportUrl ?? '');
      setAnnounceTemplate(settingsQuery.data.subscriptionAnnounceTemplate ?? '');
      setHydrated(true);
    }
  }, [settingsQuery.data, hydrated]);

  const saveMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      notifications.show({
        color: 'green',
        message: 'Метаданные подписки обновлены',
      });
    },
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Не получилось сохранить',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  function save() {
    saveMutation.mutate({
      // Empty strings clear the override (NULL in DB → header omitted).
      subscriptionProfileTitle: profileTitle.trim() || null,
      subscriptionUpdateIntervalHours:
        typeof intervalHours === 'number' ? intervalHours : 24,
      subscriptionSupportUrl: supportUrl.trim() || null,
      subscriptionAnnounceTemplate: announceTemplate.trim() || null,
    });
  }

  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="sm" mb="md">
        <ThemeIcon size={32} radius="md" variant="light" color="blue">
          <IconRss size={18} />
        </ThemeIcon>
        <Stack gap={0}>
          <Text fw={600}>Метаданные подписки</Text>
          <Text size="xs" c="dimmed">
            HTTP-заголовки которые клиенты (Hiddify / Streisand / Happ /
            V2RayNG) читают вместе с подпиской — название, частота обновления,
            квота, объявление
          </Text>
        </Stack>
      </Group>

      <Stack gap="sm" maw={620}>
        <TextInput
          label="Profile Title"
          description="Название подписки в клиенте. Пусто → используется brand name."
          value={profileTitle}
          onChange={(e) => setProfileTitle(e.currentTarget.value)}
          placeholder="Ice-Panel"
        />
        <Group grow align="flex-start">
          <NumberInput
            label="Update interval (hours)"
            description="Как часто клиент сам перетягивает подписку"
            min={1}
            max={168}
            value={intervalHours}
            onChange={(v) => setIntervalHours(typeof v === 'number' ? v : '')}
          />
          <TextInput
            label="Support URL"
            description="Кликабельная ссылка в profile detail"
            value={supportUrl}
            onChange={(e) => setSupportUrl(e.currentTarget.value)}
            placeholder="https://t.me/your_support"
          />
        </Group>
        <Textarea
          label="Announce template"
          description={
            'Banner показанный юзеру в клиенте. Поддерживает {{TRAFFIC_LEFT}}, {{DAYS_LEFT}}, {{SUPPORT_URL}}. Пусто → header не выдаётся.'
          }
          value={announceTemplate}
          onChange={(e) => setAnnounceTemplate(e.currentTarget.value)}
          placeholder="Осталось трафика: {{TRAFFIC_LEFT}} · до конца {{DAYS_LEFT}} дней · поддержка {{SUPPORT_URL}}"
          autosize
          minRows={2}
          maxRows={5}
        />
        <Group justify="flex-end">
          <Button
            onClick={save}
            loading={saveMutation.isPending}
            disabled={settingsQuery.isLoading}
            leftSection={<IconCheck size={14} />}
          >
            Сохранить
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
