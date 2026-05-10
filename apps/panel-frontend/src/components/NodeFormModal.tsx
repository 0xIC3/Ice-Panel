import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const isEdit = node !== null;
  const [step, setStep] = useState(0);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);

  const form = useForm<FormValues>({
    initialValues: defaults(node),
    validateInputOnBlur: true,
    validate: {
      name: (v) => {
        const t = v.trim();
        if (t.length === 0) return 'Имя обязательно';
        if (!/^[a-zA-Z0-9._-]+$/.test(t))
          return 'Только латиница, цифры, точка, _ и -';
        return null;
      },
      address: (v) => {
        const t = v.trim();
        if (t.length === 0) return 'Адрес обязателен';
        if (!/^[a-zA-Z0-9.-]+(:\d{1,5})?$/.test(t))
          return 'host или host:port (без http://)';
        return null;
      },
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
      // Belt-and-braces: validate() in Mantine 7 runs validators AND sets
      // form.errors so each input renders its own red message. We block
      // advancement on any error AND highlight the fields visually so the
      // user sees what's wrong.
      const result = form.validate();
      if (result.hasErrors) {
        return;
      }
      setStep(1);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={isEdit ? `${t('common.edit')} ${node.name}` : t('nodes.create')}
      size="lg"
    >
      <Stack>
        <Stepper
          active={step}
          // Жмём по цифре только в рамках уже валидной формы:
          //   - назад (step 1 → 0) разрешено всегда
          //   - вперёд (0 → 1) только если параметры валидны
          // Без проверки stepper позволял прыгнуть мимо required-полей.
          onStepClick={(target) => {
            if (target < step) {
              setStep(target);
              return;
            }
            const result = form.validate();
            if (!result.hasErrors) setStep(target);
          }}
          allowNextStepsSelect={false}
          size="sm"
        >
          <Stepper.Step
            label={t('nodes.form.stepParams')}
            description={t('nodes.form.stepParamsDesc')}
          />
          <Stepper.Step
            label={t('nodes.form.stepProfiles')}
            description={t('nodes.form.stepProfilesDesc', { count: selectedProfileIds.length })}
          />
        </Stepper>

        {step === 0 && (
          <Stack>
            <Group grow>
              <TextInput
                label={t('nodes.form.name')}
                description={t('nodes.form.nameDesc')}
                placeholder="eu-1"
                required
                {...form.getInputProps('name')}
              />
              <Select
                label={t('nodes.form.protocol')}
                description={t('nodes.form.protocolDesc')}
                data={PROTOCOL_OPTIONS}
                allowDeselect={false}
                {...form.getInputProps('protocol')}
              />
            </Group>
            <TextInput
              label={t('nodes.form.address')}
              description={t('nodes.form.addressDesc')}
              placeholder="n1.example.com:8443"
              required
              {...form.getInputProps('address')}
            />
            <Group grow>
              <Select
                label={t('nodes.form.country')}
                description={t('nodes.form.countryDesc')}
                placeholder={t('common.none')}
                data={COUNTRY_OPTIONS}
                searchable
                clearable
                nothingFoundMessage={t('common.nothingFound')}
                {...form.getInputProps('countryCode')}
              />
              <NumberInput
                label={t('nodes.form.multiplier')}
                description={t('nodes.form.multiplierDesc')}
                min={0.1}
                max={10}
                step={0.1}
                allowNegative={false}
                {...form.getInputProps('consumptionMultiplier')}
              />
            </Group>
            <Group justify="space-between" mt="md">
              <Button variant="default" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button onClick={nextStep}>{t('common.next')} →</Button>
            </Group>
          </Stack>
        )}

        {step === 1 && (
          <Stack>
            <Alert color="blue" variant="light" icon={<IconRocket size={16} />}>
              {t('nodes.form.profilesAlert')}
            </Alert>

            {profilesQuery.isLoading ? (
              <Text c="dimmed" ta="center" py="md">
                {t('common.loading')}
              </Text>
            ) : (profilesQuery.data?.profiles ?? []).length === 0 ? (
              <Paper withBorder p="md" radius="sm" ta="center">
                <Text c="dimmed" size="sm">
                  {t('nodes.form.noProfiles')}
                </Text>
              </Paper>
            ) : (
              <ScrollArea.Autosize mah={400}>
                <Stack gap="xs">
                  {profilesByMatch.match.length > 0 && (
                    <ProfileGroup
                      title={t('nodes.form.compatibleGroup')}
                      hint={t('nodes.form.compatibleHint', { protocol: form.values.protocol })}
                      color="teal"
                      profiles={profilesByMatch.match}
                      selectedIds={selectedProfileIds}
                      onToggle={toggleProfile}
                    />
                  )}
                  {profilesByMatch.mismatch.length > 0 && (
                    <ProfileGroup
                      title={t('nodes.form.mismatchGroup')}
                      hint={t('nodes.form.mismatchHint')}
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
                ← {t('common.back')}
              </Button>
              <Button onClick={handleFinalSubmit} loading={loading} leftSection={<IconServer2 size={14} />}>
                {isEdit
                  ? t('nodes.form.submitEdit')
                  : selectedProfileIds.length > 0
                    ? t('nodes.form.submitWithBindings', { count: selectedProfileIds.length })
                    : t('nodes.form.submitCreate')}
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
