import { useEffect } from 'react';
import {
  Alert,
  Button,
  Code,
  Divider,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconKey } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import {
  generateInboundKeypair,
  type CreateProfileInput,
  type Profile,
  type ProtocolName,
  type UpdateProfileInput,
} from '../lib/api';
import { RecipePicker } from './RecipePicker';
import { validateXrayConfig } from '../lib/recipes';

type Mode = 'create' | 'edit';

interface FormValues {
  protocol: ProtocolName;
  name: string;
  description: string;
  enabled: boolean;

  // Hysteria
  hyObfsPassword: string;
  hyMasqueradeUrl: string;
  hyBrutalUp: number | '';
  hyBrutalDown: number | '';

  // Xray
  xrayDest: string;
  xrayServerNames: string;
  xrayShortIds: string;
  xrayPrivateKey: string;
  xrayPublicKey: string;
  xrayFlow: string;
  xrayFingerprint: string;
  xrayNetwork: 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp';
  xrayPath: string;
  xrayHostHeader: string;
  xrayServiceName: string;
  xraySubprotocol: 'vless' | 'trojan';

  // AmneziaWG
  awgSubnet: string;
  awgServerPriv: string;
  awgServerPub: string;
  awgPreset: 'tspu' | 'mobile' | 'custom';
  awgJc: number | '';
  awgJmin: number | '';
  awgJmax: number | '';
  awgS1: number | '';
  awgS2: number | '';
  awgS3: number | '';
  awgS4: number | '';
  awgH1: number | '';
  awgH2: number | '';
  awgH3: number | '';
  awgH4: number | '';

  // Naive
  naiveHostname: string;
  naiveTlsEmail: string;
  naiveMasquerade: string;

  // Shadowsocks
  ssMethod:
    | '2022-blake3-aes-128-gcm'
    | '2022-blake3-aes-256-gcm'
    | '2022-blake3-chacha20-poly1305'
    | 'chacha20-ietf-poly1305'
    | 'aes-256-gcm'
    | 'aes-128-gcm';

  // MTProto
  mtgDomain: string;

  // Mieru
  mieruMtu: number | '';
}

const TSPU_PRESET = { jc: 4, jmin: 40, jmax: 89, s1: 72, s2: 56, s3: 32, s4: 16 };
const MOBILE_PRESET = { jc: 3, jmin: 40, jmax: 70, s1: 72, s2: 56, s3: 32, s4: 16 };

function defaults(profile: Profile | null): FormValues {
  const base: FormValues = {
    protocol: profile?.protocol ?? 'hysteria',
    name: profile?.name ?? '',
    description: profile?.description ?? '',
    enabled: profile?.enabled ?? true,

    hyObfsPassword: '',
    hyMasqueradeUrl: '',
    hyBrutalUp: '',
    hyBrutalDown: '',

    xrayDest: 'www.cloudflare.com:443',
    xrayServerNames: 'www.cloudflare.com',
    xrayShortIds: '',
    xrayPrivateKey: '',
    xrayPublicKey: '',
    xrayFlow: 'xtls-rprx-vision',
    xrayFingerprint: 'chrome',
    xrayNetwork: 'raw',
    xrayPath: '',
    xrayHostHeader: '',
    xrayServiceName: '',
    xraySubprotocol: 'vless',

    awgSubnet: '10.0.0.0/24',
    awgServerPriv: '',
    awgServerPub: '',
    awgPreset: 'tspu',
    awgJc: TSPU_PRESET.jc,
    awgJmin: TSPU_PRESET.jmin,
    awgJmax: TSPU_PRESET.jmax,
    awgS1: TSPU_PRESET.s1,
    awgS2: TSPU_PRESET.s2,
    awgS3: TSPU_PRESET.s3,
    awgS4: TSPU_PRESET.s4,
    awgH1: '',
    awgH2: '',
    awgH3: '',
    awgH4: '',

    naiveHostname: '',
    naiveTlsEmail: '',
    naiveMasquerade: '/var/www/html',

    ssMethod: '2022-blake3-aes-256-gcm',

    mtgDomain: 'www.cloudflare.com',
    mieruMtu: 1400,
  };

  if (!profile) return base;
  const cfg = profile.config as Record<string, unknown>;
  switch (profile.protocol) {
    case 'hysteria':
      return {
        ...base,
        hyObfsPassword: (cfg.obfsPassword as string) ?? '',
        hyMasqueradeUrl: (cfg.masqueradeUrl as string) ?? '',
        hyBrutalUp: (cfg.brutalUpMbps as number) ?? '',
        hyBrutalDown: (cfg.brutalDownMbps as number) ?? '',
      };
    case 'xray':
      return {
        ...base,
        xrayDest: (cfg.realityDest as string) ?? base.xrayDest,
        xrayServerNames: ((cfg.realityServerNames as string[]) ?? []).join(', '),
        xrayShortIds: ((cfg.realityShortIds as string[]) ?? []).join(', '),
        xrayPrivateKey: (cfg.realityPrivateKey as string) ?? '',
        xrayPublicKey: (cfg.realityPublicKey as string) ?? '',
        xrayFlow: (cfg.flow as string) ?? base.xrayFlow,
        xrayFingerprint: (cfg.fingerprint as string) ?? base.xrayFingerprint,
        xrayNetwork: ((cfg.network as 'raw' | 'xhttp' | 'ws' | 'grpc' | 'httpupgrade' | 'kcp') ?? 'raw'),
        xrayPath: (cfg.path as string) ?? '',
        xrayHostHeader: (cfg.host as string) ?? '',
        xrayServiceName: (cfg.serviceName as string) ?? '',
        xraySubprotocol: ((cfg.subprotocol as 'vless' | 'trojan') ?? 'vless'),
      };
    case 'amneziawg': {
      const obf = (cfg.obfuscation as Record<string, number> | undefined) ?? {};
      return {
        ...base,
        awgSubnet: (cfg.subnet as string) ?? base.awgSubnet,
        awgServerPriv: (cfg.serverPrivateKey as string) ?? '',
        awgServerPub: (cfg.serverPublicKey as string) ?? '',
        awgPreset: 'custom',
        awgJc: obf.jc ?? '',
        awgJmin: obf.jmin ?? '',
        awgJmax: obf.jmax ?? '',
        awgS1: obf.s1 ?? '',
        awgS2: obf.s2 ?? '',
        awgS3: obf.s3 ?? '',
        awgS4: obf.s4 ?? '',
        awgH1: obf.h1 ?? '',
        awgH2: obf.h2 ?? '',
        awgH3: obf.h3 ?? '',
        awgH4: obf.h4 ?? '',
      };
    }
    case 'naive':
      return {
        ...base,
        naiveHostname: (cfg.hostname as string) ?? '',
        naiveTlsEmail: (cfg.tlsEmail as string) ?? '',
        naiveMasquerade: (cfg.masqueradeRoot as string) ?? base.naiveMasquerade,
      };
    case 'shadowsocks':
      return {
        ...base,
        ssMethod: ((cfg.method as FormValues['ssMethod']) ?? base.ssMethod),
      };
    case 'mtproto':
      return {
        ...base,
        mtgDomain: (cfg.domain as string) ?? base.mtgDomain,
      };
    case 'mieru':
      return {
        ...base,
        mieruMtu: ((cfg.mtu as number) ?? base.mieruMtu),
      };
    default:
      return base;
  }
}

interface Props {
  opened: boolean;
  onClose: () => void;
  profile: Profile | null;
  onSubmit: (input: CreateProfileInput | UpdateProfileInput, mode: Mode) => Promise<void>;
  loading?: boolean;
}

export function ProfileFormModal({ opened, onClose, profile, onSubmit, loading }: Props) {
  const isEdit = profile !== null;
  const mode: Mode = isEdit ? 'edit' : 'create';

  const form = useForm<FormValues>({
    initialValues: defaults(profile),
    validate: {
      name: (v) => (v.length < 1 ? 'Required' : null),
    },
  });

  useEffect(() => {
    if (opened) form.setValues(defaults(profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, profile?.id]);

  const keypairMutation = useMutation({
    mutationFn: (protocol: 'xray' | 'amneziawg') => generateInboundKeypair(protocol),
    onError: (err) =>
      notifications.show({
        color: 'red',
        title: 'Generate failed',
        message: err instanceof Error ? err.message : String(err),
      }),
  });

  async function generateXrayKeys() {
    const kp = await keypairMutation.mutateAsync('xray');
    form.setValues({ ...form.values, xrayPrivateKey: kp.privateKey, xrayPublicKey: kp.publicKey });
    notifications.show({ color: 'green', message: 'REALITY keypair generated' });
  }

  async function generateAwgKeys() {
    const kp = await keypairMutation.mutateAsync('amneziawg');
    form.setValues({ ...form.values, awgServerPriv: kp.privateKey, awgServerPub: kp.publicKey });
    notifications.show({ color: 'green', message: 'AmneziaWG server keypair generated' });
  }

  function applyAwgPreset(preset: 'tspu' | 'mobile' | 'custom') {
    form.setFieldValue('awgPreset', preset);
    if (preset === 'tspu') {
      form.setValues({ ...form.values, awgPreset: preset, ...renameAwg(TSPU_PRESET) });
    } else if (preset === 'mobile') {
      form.setValues({ ...form.values, awgPreset: preset, ...renameAwg(MOBILE_PRESET) });
    }
  }

  async function handleSubmit(values: FormValues) {
    let config: Record<string, unknown>;
    switch (values.protocol) {
      case 'hysteria':
        config = {
          ...(values.hyObfsPassword ? { obfsPassword: values.hyObfsPassword } : {}),
          ...(values.hyMasqueradeUrl ? { masqueradeUrl: values.hyMasqueradeUrl } : {}),
          ...(values.hyBrutalUp ? { brutalUpMbps: Number(values.hyBrutalUp) } : {}),
          ...(values.hyBrutalDown ? { brutalDownMbps: Number(values.hyBrutalDown) } : {}),
        };
        break;
      case 'xray':
        config = {
          realityDest: values.xrayDest,
          realityServerNames: csvList(values.xrayServerNames),
          realityShortIds: csvList(values.xrayShortIds),
          realityPrivateKey: values.xrayPrivateKey,
          realityPublicKey: values.xrayPublicKey,
          flow: values.xrayFlow,
          fingerprint: values.xrayFingerprint,
          network: values.xrayNetwork,
          subprotocol: values.xraySubprotocol,
          ...(values.xrayPath ? { path: values.xrayPath } : {}),
          ...(values.xrayHostHeader ? { host: values.xrayHostHeader } : {}),
          ...(values.xrayServiceName ? { serviceName: values.xrayServiceName } : {}),
        };
        break;
      case 'amneziawg':
        config = {
          subnet: values.awgSubnet,
          serverPrivateKey: values.awgServerPriv,
          serverPublicKey: values.awgServerPub,
          obfuscation: {
            jc: numOr(values.awgJc, 4),
            jmin: numOr(values.awgJmin, 40),
            jmax: numOr(values.awgJmax, 70),
            s1: numOr(values.awgS1, 72),
            s2: numOr(values.awgS2, 56),
            s3: numOr(values.awgS3, 32),
            s4: numOr(values.awgS4, 16),
            h1: numOr(values.awgH1, 0),
            h2: numOr(values.awgH2, 0),
            h3: numOr(values.awgH3, 0),
            h4: numOr(values.awgH4, 0),
          },
        };
        break;
      case 'naive':
        config = {
          hostname: values.naiveHostname,
          tlsEmail: values.naiveTlsEmail,
          masqueradeRoot: values.naiveMasquerade,
        };
        break;
      case 'shadowsocks':
        config = { method: values.ssMethod };
        break;
      case 'mtproto':
        config = { domain: values.mtgDomain };
        break;
      case 'mieru':
        config = { mtu: values.mieruMtu === '' ? 1400 : Number(values.mieruMtu) };
        break;
    }

    if (isEdit) {
      const update: UpdateProfileInput = {
        name: values.name,
        description: values.description.trim() || null,
        enabled: values.enabled,
        config: config as never,
      };
      await onSubmit(update, mode);
    } else {
      const create: CreateProfileInput = {
        protocol: values.protocol,
        name: values.name,
        description: values.description.trim() || null,
        enabled: values.enabled,
        config: config as never,
      };
      await onSubmit(create, mode);
    }
    onClose();
    form.reset();
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        form.reset();
        onClose();
      }}
      title={isEdit ? `Профиль: ${profile.name}` : 'Создать профиль'}
      size="lg"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <Group grow>
            <TextInput
              label="Имя"
              placeholder="vless-reality"
              required
              {...form.getInputProps('name')}
            />
            <Select
              label="Протокол"
              data={[
                { value: 'hysteria', label: 'Hysteria 2' },
                { value: 'xray', label: 'Xray (VLESS / Trojan + REALITY)' },
                { value: 'amneziawg', label: 'AmneziaWG' },
                { value: 'naive', label: 'NaiveProxy' },
                { value: 'shadowsocks', label: 'Shadowsocks 2022' },
                { value: 'mtproto', label: 'MTProto (Telegram-only, mtg)' },
                { value: 'mieru', label: 'Mieru (stealth proxy)' },
              ]}
              disabled={isEdit}
              allowDeselect={false}
              {...form.getInputProps('protocol')}
            />
          </Group>

          <Textarea
            label="Описание"
            placeholder="Назначение профиля (опционально)"
            autosize
            minRows={1}
            maxRows={3}
            {...form.getInputProps('description')}
          />

          <Switch label="Включён" {...form.getInputProps('enabled', { type: 'checkbox' })} />

          <Divider label={`Конфигурация: ${form.values.protocol}`} labelPosition="center" />

          <RecipePicker
            protocol={form.values.protocol}
            onPick={async (recipe) => {
              // Apply recipe field overrides first.
              form.setValues((current) => ({ ...current, ...recipe.apply }));

              // Auto-fill missing crypto material so admin doesn't have to
              // chase 4 separate buttons (private key, public key, shortIds,
              // peer keys). Recipe = "I want this combo working" should mean
              // "form is ready to submit" after one click.
              if (recipe.protocol === 'xray') {
                const shortIdsEmpty = !form.values.xrayShortIds.trim();
                const keysEmpty = !form.values.xrayPrivateKey;
                const updates: Partial<FormValues> = {};

                if (shortIdsEmpty) {
                  // 6 random 16-hex-char shortIds — clients can pick any of
                  // them in their URI, REALITY accepts whichever matches.
                  // Multiple shortIds let admin rotate without breaking
                  // existing subscriptions.
                  updates.xrayShortIds = Array.from({ length: 6 }, () =>
                    Array.from({ length: 16 }, () =>
                      Math.floor(Math.random() * 16).toString(16),
                    ).join(''),
                  ).join(', ');
                }

                if (keysEmpty) {
                  try {
                    const kp = await keypairMutation.mutateAsync('xray');
                    updates.xrayPrivateKey = kp.privateKey;
                    updates.xrayPublicKey = kp.publicKey;
                  } catch {
                    // Soft-fail — admin can still hit "Сгенерировать" manually.
                  }
                }

                if (Object.keys(updates).length > 0) {
                  form.setValues((current) => ({ ...current, ...updates }));
                }
              }

              if (recipe.protocol === 'amneziawg' && !form.values.awgServerPriv) {
                try {
                  const kp = await keypairMutation.mutateAsync('amneziawg');
                  form.setValues((current) => ({
                    ...current,
                    awgServerPriv: kp.privateKey,
                    awgServerPub: kp.publicKey,
                  }));
                } catch {
                  /* soft-fail */
                }
              }
            }}
          />

          {form.values.protocol === 'xray' && (() => {
            const issues = validateXrayConfig({
              xrayNetwork: form.values.xrayNetwork,
              xrayFlow: form.values.xrayFlow,
              xraySubprotocol: form.values.xraySubprotocol,
            });
            if (issues.length === 0) return null;
            return (
              <Stack gap={4}>
                {issues.map((iss, i) => (
                  <Alert
                    key={i}
                    color={
                      iss.level === 'error'
                        ? 'red'
                        : iss.level === 'warning'
                          ? 'yellow'
                          : 'blue'
                    }
                    variant="light"
                    p="xs"
                  >
                    <Text size="xs">{iss.message}</Text>
                  </Alert>
                ))}
              </Stack>
            );
          })()}

          {form.values.protocol === 'hysteria' && (
            <Stack>
              <PasswordInput
                label="Salamander obfs password"
                description="Опционально. Пусто — без обфускации."
                {...form.getInputProps('hyObfsPassword')}
              />
              <TextInput
                label="Masquerade URL"
                placeholder="https://en.wikipedia.org"
                {...form.getInputProps('hyMasqueradeUrl')}
              />
              <Group grow>
                <NumberInput label="Brutal CC up Mbps" min={1} {...form.getInputProps('hyBrutalUp')} />
                <NumberInput label="Brutal CC down Mbps" min={1} {...form.getInputProps('hyBrutalDown')} />
              </Group>
            </Stack>
          )}

          {form.values.protocol === 'xray' && (
            <Stack>
              <TextInput
                label="REALITY dest (target site)"
                description="host:port — fronting decoy"
                placeholder="www.cloudflare.com:443"
                required
                {...form.getInputProps('xrayDest')}
              />
              <TextInput
                label="REALITY serverNames (через запятую)"
                placeholder="www.cloudflare.com, cdn.cloudflare.com"
                required
                {...form.getInputProps('xrayServerNames')}
              />
              <TextInput
                label="REALITY shortIds (через запятую, hex)"
                placeholder="abc123, deadbeef"
                required
                {...form.getInputProps('xrayShortIds')}
              />
              <Group align="end" wrap="nowrap" gap="xs">
                <PasswordInput
                  flex={1}
                  label="REALITY private key"
                  description="curve25519 base64. «Сгенерировать» или вставить из `xray x25519`."
                  required
                  {...form.getInputProps('xrayPrivateKey')}
                />
                <Button
                  leftSection={<IconKey size={14} />}
                  variant="light"
                  loading={keypairMutation.isPending}
                  onClick={generateXrayKeys}
                  type="button"
                >
                  Сгенерировать
                </Button>
              </Group>
              <TextInput label="REALITY public key" required {...form.getInputProps('xrayPublicKey')} />
              <Select
                label="Subprotocol"
                description="VLESS — каноничный, поддерживает Vision flow. Trojan — пароль вместо UUID, без Vision."
                data={[
                  { value: 'vless', label: 'VLESS (canonical, supports Vision flow)' },
                  { value: 'trojan', label: 'Trojan (password auth, no Vision)' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('xraySubprotocol')}
              />
              <Group grow>
                <Select
                  label="Flow"
                  description="Vision работает только с raw (TCP). Для xhttp/ws/grpc/kcp/httpupgrade ставь «none»"
                  data={[
                    { value: 'xtls-rprx-vision', label: 'xtls-rprx-vision' },
                    { value: 'xtls-rprx-vision-udp443', label: 'xtls-rprx-vision-udp443' },
                    { value: '', label: '(none) — без flow' },
                  ]}
                  {...form.getInputProps('xrayFlow')}
                />
                <Select
                  label="Fingerprint"
                  data={['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', 'random']}
                  {...form.getInputProps('xrayFingerprint')}
                />
              </Group>
              <Select
                label="Network (transport)"
                description="REALITY поддерживает только raw / xhttp / grpc. ws/httpupgrade/kcp xray отвергает на уровне config-load."
                data={[
                  { value: 'raw', label: 'raw (TCP, canonical) — supports Vision' },
                  { value: 'xhttp', label: 'xhttp (HTTP/2 chunked)' },
                  { value: 'grpc', label: 'gRPC' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('xrayNetwork')}
              />
              {(form.values.xrayNetwork === 'ws' ||
                form.values.xrayNetwork === 'xhttp' ||
                form.values.xrayNetwork === 'httpupgrade') && (
                <Group grow>
                  <TextInput label="Path" placeholder="/" {...form.getInputProps('xrayPath')} />
                  <TextInput
                    label="Host header"
                    placeholder="cdn.example.com"
                    {...form.getInputProps('xrayHostHeader')}
                  />
                </Group>
              )}
              {form.values.xrayNetwork === 'grpc' && (
                <TextInput
                  label="gRPC serviceName"
                  placeholder="GunService"
                  required
                  {...form.getInputProps('xrayServiceName')}
                />
              )}
            </Stack>
          )}

          {form.values.protocol === 'amneziawg' && (
            <Stack>
              <TextInput
                label="Subnet (CIDR)"
                placeholder="10.0.0.0/24"
                required
                {...form.getInputProps('awgSubnet')}
              />
              <Group align="end" wrap="nowrap" gap="xs">
                <PasswordInput
                  flex={1}
                  label="Server private key"
                  required
                  {...form.getInputProps('awgServerPriv')}
                />
                <Button
                  leftSection={<IconKey size={14} />}
                  variant="light"
                  loading={keypairMutation.isPending}
                  onClick={generateAwgKeys}
                  type="button"
                >
                  Сгенерировать
                </Button>
              </Group>
              <TextInput label="Server public key" required {...form.getInputProps('awgServerPub')} />
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  Obfuscation preset
                </Text>
                <SegmentedControl
                  value={form.values.awgPreset}
                  onChange={(v) => applyAwgPreset(v as 'tspu' | 'mobile' | 'custom')}
                  data={[
                    { label: 'TSPU (Russia DPI)', value: 'tspu' },
                    { label: 'Mobile', value: 'mobile' },
                    { label: 'Custom', value: 'custom' },
                  ]}
                />
              </Stack>
              <Group grow>
                <NumberInput label="Jc" min={0} {...form.getInputProps('awgJc')} />
                <NumberInput label="Jmin" min={0} {...form.getInputProps('awgJmin')} />
                <NumberInput label="Jmax" min={0} {...form.getInputProps('awgJmax')} />
              </Group>
              <Group grow>
                <NumberInput label="S1" min={0} {...form.getInputProps('awgS1')} />
                <NumberInput label="S2" min={0} {...form.getInputProps('awgS2')} />
                <NumberInput label="S3" min={0} {...form.getInputProps('awgS3')} />
                <NumberInput label="S4" min={0} {...form.getInputProps('awgS4')} />
              </Group>
              <Group grow>
                <NumberInput label="H1" min={5} {...form.getInputProps('awgH1')} />
                <NumberInput label="H2" min={5} {...form.getInputProps('awgH2')} />
                <NumberInput label="H3" min={5} {...form.getInputProps('awgH3')} />
                <NumberInput label="H4" min={5} {...form.getInputProps('awgH4')} />
              </Group>
              <Alert color="yellow" title="H1-H4">
                Должны быть {'>'}4 и попарно различные. Сгенерируй через{' '}
                <Code>shuf -i 5-2147483647 -n 4</Code>.
              </Alert>
            </Stack>
          )}

          {form.values.protocol === 'naive' && (
            <Stack>
              <TextInput
                label="Public hostname"
                placeholder="n1.example.com"
                required
                {...form.getInputProps('naiveHostname')}
              />
              <TextInput
                label="TLS contact email"
                placeholder="ops@example.com"
                required
                {...form.getInputProps('naiveTlsEmail')}
              />
              <TextInput
                label="Masquerade root"
                placeholder="/var/www/html"
                {...form.getInputProps('naiveMasquerade')}
              />
            </Stack>
          )}

          {form.values.protocol === 'shadowsocks' && (
            <Stack>
              <Select
                label="Cipher method"
                data={[
                  { value: '2022-blake3-aes-256-gcm', label: '2022-blake3-aes-256-gcm (recommended)' },
                  { value: '2022-blake3-aes-128-gcm', label: '2022-blake3-aes-128-gcm' },
                  { value: '2022-blake3-chacha20-poly1305', label: '2022-blake3-chacha20-poly1305' },
                  { value: 'chacha20-ietf-poly1305', label: 'chacha20-ietf-poly1305 (legacy AEAD)' },
                  { value: 'aes-256-gcm', label: 'aes-256-gcm (legacy AEAD)' },
                  { value: 'aes-128-gcm', label: 'aes-128-gcm (legacy AEAD)' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('ssMethod')}
              />
              <Alert color="blue" variant="light">
                <Text size="sm">
                  Per-user пароль = <Code>xrayUuid</Code> пользователя. Включи у юзера
                  протокол <Code>shadowsocks</Code> в списке протоколов.
                </Text>
              </Alert>
            </Stack>
          )}

          {form.values.protocol === 'mtproto' && (
            <Stack>
              <TextInput
                label="Masquerade domain"
                placeholder="www.cloudflare.com"
                required
                {...form.getInputProps('mtgDomain')}
              />
              <Alert color="yellow" variant="light">
                <Text size="sm">
                  Смена домена ротирует секреты ВСЕХ юзеров — старые подписки перестанут
                  работать.
                </Text>
              </Alert>
            </Stack>
          )}

          {form.values.protocol === 'mieru' && (
            <Stack>
              <NumberInput
                label="MTU"
                placeholder="1400"
                min={576}
                max={1500}
                {...form.getInputProps('mieruMtu')}
              />
            </Stack>
          )}

          <Button type="submit" loading={loading} fullWidth>
            {isEdit ? 'Сохранить' : 'Создать профиль'}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function csvList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);
}

function numOr(v: number | '' | undefined, fallback: number): number {
  return v === '' || v === undefined ? fallback : Number(v);
}

function renameAwg(p: { jc: number; jmin: number; jmax: number; s1: number; s2: number; s3: number; s4: number }) {
  return {
    awgJc: p.jc, awgJmin: p.jmin, awgJmax: p.jmax,
    awgS1: p.s1, awgS2: p.s2, awgS3: p.s3, awgS4: p.s4,
  };
}
