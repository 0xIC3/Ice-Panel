import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Stepper,
  Text,
  TextInput,
  ThemeIcon,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { IconBolt, IconRocket, IconServer2 } from '@tabler/icons-react';
import {
  listProfiles,
  type CreateNodeInput,
  type Node,
  type NodeProtocol,
  type Profile,
  type UpdateNodeInput,
} from '../lib/api';
import { COUNTRY_OPTIONS } from '../lib/countries';

const PROTOCOL_OPTIONS: { value: NodeProtocol; label: string }[] = [
  { value: 'xray', label: 'Xray (VLESS / Trojan + REALITY)' },
  { value: 'hysteria', label: 'Hysteria 2' },
  { value: 'amneziawg', label: 'AmneziaWG' },
  { value: 'naive', label: 'NaiveProxy' },
  { value: 'shadowsocks', label: 'Shadowsocks 2022' },
  { value: 'mtproto', label: 'MTProto (Telegram-only)' },
  { value: 'mieru', label: 'Mieru (stealth proxy)' },
];

interface FormValues {
  name: string;
  address: string;
  protocol: NodeProtocol;
  countryCode: string;
  consumptionMultiplier: number | '';
}

function defaults(node: Node | null): FormValues {
  return {
    name: node?.name ?? '',
    address: node?.address ?? '',
    protocol: node?.protocol ?? 'xray',
    countryCode: node?.countryCode ?? '',
    consumptionMultiplier: node ? Number(node.consumptionMultiplier) : 1,
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  node: Node | null;
  /**
   * On submit, the modal also returns a list of profile IDs the admin
   * picked on step 2. Caller is responsible for creating bindings for each
   * after the node is registered (caller has the binding API + node ID).
   */
  onSubmit: (
    input: CreateNodeInput | UpdateNodeInput,
    profileIds: string[],
  ) => Promise<void>;
  loading?: boolean;
}

export function NodeFormModal({ opened, onClose, node, onSubmit, loading }: Props) {
  const isEdit = node !== null;
  const [step, setStep] = useState(0);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);

  const form = useForm<FormValues>({
    initialValues: defaults(node),
    validate: {
      name: (v) =>
        v.length < 1 || !/^[a-zA-Z0-9._-]+$/.test(v)
          ? 'Letters, digits, dot, underscore, hyphen only'
          : null,
      address: (v) =>
        !/^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(v)
          ? 'host or host:port (no scheme)'
          : null,
    },
  });

  // Reset wizard state every time the modal opens fresh (or switches mode).
  useEffect(() => {
    if (opened) {
      setStep(0);
      setSelectedProfileIds([]);
      form.setValues(defaults(node));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, node]);

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: () => listProfiles(),
    enabled: opened,
  });

  // Profiles split: those matching the node's chosen protocol vs the rest.
  // Matching profiles are deployable today (binary present after install);
  // mismatched ones get a warning + still selectable (admin might be
  // running multi-protocol install separately).
  const profilesByMatch = useMemo(() => {
    const all = profilesQuery.data?.profiles ?? [];
    const match = all.filter((p) => p.protocol === form.values.protocol);
    const mismatch = all.filter((p) => p.protocol !== form.values.protocol);
    return { match, mismatch };
  }, [profilesQuery.data, form.values.protocol]);

  function toggleProfile(id: string) {
    setSelectedProfileIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleClose() {
    form.reset();
    setStep(0);
    setSelectedProfileIds([]);
    onClose();
  }

  async function handleFinalSubmit() {
    const values = form.values;
    const base = {
      name: values.name,
      address: values.address,
      protocol: values.protocol,
      countryCode: values.countryCode || null,
      consumptionMultiplier:
        values.consumptionMultiplier === '' ? 1 : Number(values.consumptionMultiplier),
    };
    if (isEdit) {
      await onSubmit(base satisfies UpdateNodeInput, selectedProfileIds);
    } else {
      await onSubmit(base satisfies CreateNodeInput, selectedProfileIds);
    }
    handleClose();
  }

  function nextStep() {
    if (step === 0) {
      const v = form.validate();
      if (v.hasErrors) return;
      setStep(1);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={isEdit ? `Изменить ${node.name}` : 'Создать ноду'}
      size="lg"
    >
      <Stack>
        <Stepper active={step} onStepClick={setStep} size="sm">
          <Stepper.Step label="Параметры" description="Имя, адрес, протокол" />
          <Stepper.Step
            label="Профили"
            description={`Auto-deploy (${selectedProfileIds.length})`}
          />
        </Stepper>

        {step === 0 && (
          <Stack>
            <Group grow align="flex-start">
              <TextInput
                label="Имя"
                description="уникальное в рамках панели"
                placeholder="eu-1"
                required
                {...form.getInputProps('name')}
              />
              <Select
                label="Протокол"
                description="основной core ноды (install-node ставит этот бинарь)"
                data={PROTOCOL_OPTIONS}
                allowDeselect={false}
                {...form.getInputProps('protocol')}
              />
            </Group>
            <TextInput
              label="Адрес (host:port для panel-mTLS)"
              description="control-plane endpoint. Hysteria/xray protocol-port — отдельно."
              placeholder="n1.example.com:8443"
              required
              {...form.getInputProps('address')}
            />
            <Group grow align="flex-start">
              <Select
                label="Страна"
                description="ISO 3166-1 — для GeoIP routing и UI badge"
                placeholder="Не указана"
                data={COUNTRY_OPTIONS}
                searchable
                clearable
                nothingFoundMessage="Не найдено"
                {...form.getInputProps('countryCode')}
              />
              <NumberInput
                label="Consumption multiplier"
                description="множитель учёта трафика (1 = норма)"
                min={0.1}
                max={10}
                step={0.1}
                allowNegative={false}
                {...form.getInputProps('consumptionMultiplier')}
              />
            </Group>
            <Group justify="space-between" mt="md">
              <Button variant="default" onClick={handleClose}>
                Отмена
              </Button>
              <Button onClick={nextStep}>Далее →</Button>
            </Group>
          </Stack>
        )}

        {step === 1 && (
          <Stack>
            <Alert color="blue" variant="light" icon={<IconRocket size={16} />}>
              Отметь профили которые сразу развернуть на этой ноде. Bindings
              создадутся автоматически после регистрации. Можно ничего не
              выбирать — позже задеплоишь через карточку Profile.
            </Alert>

            {profilesQuery.isLoading ? (
              <Text c="dimmed" ta="center" py="md">
                Загружаю профили…
              </Text>
            ) : (profilesQuery.data?.profiles ?? []).length === 0 ? (
              <Paper withBorder p="md" radius="sm" ta="center">
                <Text c="dimmed" size="sm">
                  Профилей в системе пока нет — пропусти этот шаг и создай
                  ноду без bindings. Позже сходишь на /profiles → создашь
                  профиль → задеплоишь сюда.
                </Text>
              </Paper>
            ) : (
              <ScrollArea.Autosize mah={400}>
                <Stack gap="xs">
                  {profilesByMatch.match.length > 0 && (
                    <ProfileGroup
                      title="Совместимые с протоколом"
                      hint={`Эти профили сразу заработают на ${form.values.protocol}-ноде`}
                      color="teal"
                      profiles={profilesByMatch.match}
                      selectedIds={selectedProfileIds}
                      onToggle={toggleProfile}
                    />
                  )}
                  {profilesByMatch.mismatch.length > 0 && (
                    <ProfileGroup
                      title="Других протоколов"
                      hint={`Binding создастся, но клиенты не подключатся пока install-node не поставит соответствующий бинарь`}
                      color="yellow"
                      profiles={profilesByMatch.mismatch}
                      selectedIds={selectedProfileIds}
                      onToggle={toggleProfile}
                    />
                  )}
                </Stack>
              </ScrollArea.Autosize>
            )}

            <Group justify="space-between" mt="md">
              <Button variant="default" onClick={() => setStep(0)}>
                ← Назад
              </Button>
              <Button onClick={handleFinalSubmit} loading={loading} leftSection={<IconServer2 size={14} />}>
                {isEdit ? 'Сохранить' : 'Создать ноду'}
                {selectedProfileIds.length > 0 && ` + ${selectedProfileIds.length} bindings`}
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

function ProfileGroup({
  title,
  hint,
  color,
  profiles,
  selectedIds,
  onToggle,
}: {
  title: string;
  hint: string;
  color: string;
  profiles: Profile[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <Box>
      <Group gap={6} mb={4}>
        <Badge variant="light" color={color} size="sm">
          {title}
        </Badge>
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      </Group>
      <Stack gap={4}>
        {profiles.map((p) => {
          const checked = selectedIds.includes(p.id);
          return (
            <Group
              key={p.id}
              wrap="nowrap"
              gap="sm"
              px="sm"
              py={8}
              onClick={() => onToggle(p.id)}
              style={{
                cursor: 'pointer',
                borderRadius: 6,
                background: checked
                  ? 'var(--mantine-color-dark-5)'
                  : 'var(--mantine-color-dark-6)',
                transition: 'background 0.1s',
              }}
            >
              <Checkbox checked={checked} readOnly tabIndex={-1} />
              <ThemeIcon variant="light" color={color} size="sm">
                <IconBolt size={12} />
              </ThemeIcon>
              <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" fw={500} truncate>
                    {p.name}
                  </Text>
                  <Badge variant="light" color="cyan" size="xs" tt="uppercase">
                    {p.protocol}
                  </Badge>
                  {!p.enabled && (
                    <Badge variant="default" color="gray" size="xs">
                      off
                    </Badge>
                  )}
                </Group>
                {p.description && (
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {p.description}
                  </Text>
                )}
              </Stack>
            </Group>
          );
        })}
      </Stack>
    </Box>
  );
}
