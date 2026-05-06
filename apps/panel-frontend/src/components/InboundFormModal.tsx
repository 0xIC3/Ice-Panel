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
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconKey } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import {
  generateInboundKeypair,
  type CreateInboundInput,
  type Inbound,
  type Node,
  type ProtocolName,
  type UpdateInboundInput,
} from '../lib/api';

type Mode = 'create' | 'edit';

interface FormValues {
  nodeId: string;
  protocol: ProtocolName;
  name: string;
  port: number | '';
  enabled: boolean;

  // Slice 25 — public-facing host/port for client URIs. Empty string clears
  // the override and falls back to the node's address.
  publicHost: string;
  publicPort: number | '';

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
  xrayNetwork: 'raw' | 'xhttp' | 'ws' | 'grpc';
  xrayPath: string;
  xrayHostHeader: string;
  xrayServiceName: string;

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
}

const TSPU_PRESET = { jc: 4, jmin: 40, jmax: 89, s1: 72, s2: 56, s3: 32, s4: 16 };
const MOBILE_PRESET = { jc: 3, jmin: 40, jmax: 70, s1: 72, s2: 56, s3: 32, s4: 16 };

function defaults(rule: Inbound | null, defaultNodeId: string): FormValues {
  const base: FormValues = {
    nodeId: rule?.nodeId ?? defaultNodeId,
    protocol: rule?.protocol ?? 'hysteria',
    name: rule?.name ?? '',
    port: rule?.port ?? 443,
    enabled: rule?.enabled ?? true,

    publicHost: rule?.publicHost ?? '',
    publicPort: rule?.publicPort ?? '',

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
  };

  if (!rule) return base;
  // Pre-fill protocol-specific fields from existing config.
  const cfg = rule.config as Record<string, unknown>;
  switch (rule.protocol) {
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
        xrayNetwork: ((cfg.network as 'raw' | 'xhttp' | 'ws' | 'grpc') ?? 'raw'),
        xrayPath: (cfg.path as string) ?? '',
        xrayHostHeader: (cfg.host as string) ?? '',
        xrayServiceName: (cfg.serviceName as string) ?? '',
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
    default:
      return base;
  }
}

interface Props {
  opened: boolean;
  onClose: () => void;
  inbound: Inbound | null;
  nodes: Node[];
  onSubmit: (input: CreateInboundInput | UpdateInboundInput, mode: Mode) => Promise<void>;
  loading?: boolean;
}

export function InboundFormModal({ opened, onClose, inbound, nodes, onSubmit, loading }: Props) {
  const isEdit = inbound !== null;
  const mode: Mode = isEdit ? 'edit' : 'create';
  const firstNodeId = nodes[0]?.id ?? '';

  const form = useForm<FormValues>({
    initialValues: defaults(inbound, firstNodeId),
    validate: {
      name: (v) => (v.length < 1 ? 'Required' : null),
      port: (v) => (v === '' || v < 1 || v > 65535 ? '1..65535' : null),
      nodeId: (v) => (v === '' ? 'Pick a node' : null),
    },
  });

  // Re-seed when inbound prop changes (open edit on a different row).
  useEffect(() => {
    if (opened) form.setValues(defaults(inbound, firstNodeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, inbound?.id]);

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
    const port = Number(values.port);

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
    }

    // Slice 25: empty string → null (clears the override on update, omits
    // it on create). The backend treats null as "use node.address fallback".
    const publicHost = values.publicHost.trim() === '' ? null : values.publicHost.trim();
    const publicPort = values.publicPort === '' ? null : Number(values.publicPort);

    if (isEdit) {
      const update: UpdateInboundInput = {
        name: values.name,
        port,
        enabled: values.enabled,
        publicHost,
        publicPort,
        config: config as never,
      };
      await onSubmit(update, mode);
    } else {
      const create: CreateInboundInput = {
        nodeId: values.nodeId,
        protocol: values.protocol,
        name: values.name,
        port,
        enabled: values.enabled,
        ...(publicHost ? { publicHost } : {}),
        ...(publicPort ? { publicPort } : {}),
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
      title={isEdit ? `Edit "${inbound.name}"` : 'Create inbound'}
      size="lg"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <Select
            label="Node"
            data={nodes.map((n) => ({ value: n.id, label: `${n.name} (${n.address})` }))}
            disabled={isEdit}
            allowDeselect={false}
            {...form.getInputProps('nodeId')}
          />

          <Select
            label="Protocol"
            data={[
              { value: 'hysteria', label: 'Hysteria 2' },
              { value: 'xray', label: 'Xray (VLESS+REALITY)' },
              { value: 'amneziawg', label: 'AmneziaWG' },
              { value: 'naive', label: 'NaiveProxy' },
            ]}
            disabled={isEdit}
            allowDeselect={false}
            {...form.getInputProps('protocol')}
          />

          <Group grow>
            <TextInput label="Name" placeholder="hy-eu-1" required {...form.getInputProps('name')} />
            <NumberInput
              label="Port"
              min={1}
              max={65535}
              allowDecimal={false}
              allowNegative={false}
              {...form.getInputProps('port')}
            />
          </Group>

          <Group grow align="flex-start">
            <TextInput
              label="Public host (override)"
              placeholder="leave blank → use node address"
              description="What clients see in the subscription URL. Set this when the node's address is a private IP or differs from the public FQDN."
              {...form.getInputProps('publicHost')}
            />
            <NumberInput
              label="Public port (override)"
              placeholder="same as Port"
              description="Rare. Set when CDN/Cloudflare/port-forwarding maps a different external port."
              min={1}
              max={65535}
              allowDecimal={false}
              allowNegative={false}
              {...form.getInputProps('publicPort')}
            />
          </Group>

          <Switch label="Enabled" {...form.getInputProps('enabled', { type: 'checkbox' })} />

          <Divider label={`${form.values.protocol} configuration`} labelPosition="center" />

          {form.values.protocol === 'hysteria' && (
            <Stack>
              <PasswordInput
                label="Salamander obfs password"
                description="Optional. Leave empty for no obfuscation."
                {...form.getInputProps('hyObfsPassword')}
              />
              <TextInput
                label="Masquerade URL"
                placeholder="https://en.wikipedia.org"
                {...form.getInputProps('hyMasqueradeUrl')}
              />
              <Group grow>
                <NumberInput
                  label="Brutal CC up Mbps"
                  min={1}
                  allowDecimal={false}
                  {...form.getInputProps('hyBrutalUp')}
                />
                <NumberInput
                  label="Brutal CC down Mbps"
                  min={1}
                  allowDecimal={false}
                  {...form.getInputProps('hyBrutalDown')}
                />
              </Group>
            </Stack>
          )}

          {form.values.protocol === 'xray' && (
            <Stack>
              <TextInput
                label="REALITY dest (target site)"
                description="host:port, used as fronting decoy. Validate via xray tls ping."
                placeholder="www.cloudflare.com:443"
                required
                {...form.getInputProps('xrayDest')}
              />
              <TextInput
                label="REALITY serverNames (comma-separated)"
                placeholder="www.cloudflare.com, cdn.cloudflare.com"
                required
                {...form.getInputProps('xrayServerNames')}
              />
              <TextInput
                label="REALITY shortIds (comma-separated hex)"
                placeholder="abc123, deadbeef"
                required
                {...form.getInputProps('xrayShortIds')}
              />
              <Group align="end" wrap="nowrap" gap="xs">
                <PasswordInput
                  flex={1}
                  label="REALITY private key"
                  description="curve25519, base64. Click Generate or paste from `xray x25519`."
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
                  Generate
                </Button>
              </Group>
              <TextInput
                label="REALITY public key"
                description="Paired with private key — emitted in client URI. Auto-filled by Generate."
                required
                {...form.getInputProps('xrayPublicKey')}
              />
              <Group grow>
                <Select
                  label="Flow"
                  data={['xtls-rprx-vision', 'xtls-rprx-vision-udp443', '']}
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
                description="raw = canonical REALITY+Vision. ws/grpc/xhttp work but Vision only pairs with raw/xhttp."
                data={[
                  { value: 'raw', label: 'raw (TCP, was `tcp` pre-v24.9.30)' },
                  { value: 'xhttp', label: 'xhttp (HTTP/2 chunked, was `splithttp`)' },
                  { value: 'ws', label: 'ws (WebSocket)' },
                  { value: 'grpc', label: 'gRPC' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('xrayNetwork')}
              />
              {(form.values.xrayNetwork === 'ws' || form.values.xrayNetwork === 'xhttp') && (
                <Group grow>
                  <TextInput
                    label="Path"
                    placeholder="/"
                    description="HTTP path the client sends (default `/`)"
                    {...form.getInputProps('xrayPath')}
                  />
                  <TextInput
                    label="Host header"
                    placeholder="cdn.example.com"
                    description="Optional Host: header override (CDN fronting)"
                    {...form.getInputProps('xrayHostHeader')}
                  />
                </Group>
              )}
              {form.values.xrayNetwork === 'grpc' && (
                <TextInput
                  label="gRPC serviceName"
                  placeholder="GunService"
                  description="Required for gRPC transport"
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
                description="IPs handed to peers. /24 = 253 peers."
                required
                {...form.getInputProps('awgSubnet')}
              />
              <Group align="end" wrap="nowrap" gap="xs">
                <PasswordInput
                  flex={1}
                  label="Server private key"
                  description="curve25519, base64. Click Generate or paste from `awg genkey`."
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
                  Generate
                </Button>
              </Group>
              <TextInput
                label="Server public key"
                description="Auto-filled by Generate, or paste from `awg pubkey < private`."
                required
                {...form.getInputProps('awgServerPub')}
              />
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
                Must be set, &gt;4, pairwise distinct. Generate with{' '}
                <Code>shuf -i 5-2147483647 -n 4</Code> or pick 4 distinct random ints.
              </Alert>
            </Stack>
          )}

          {form.values.protocol === 'naive' && (
            <Stack>
              <TextInput
                label="Public hostname"
                placeholder="n1.example.com"
                description="Caddy answers ACME on this name. DNS A-record required."
                required
                {...form.getInputProps('naiveHostname')}
              />
              <TextInput
                label="TLS contact email"
                placeholder="ops@example.com"
                description="ACME contact — Let's Encrypt notifies here."
                required
                {...form.getInputProps('naiveTlsEmail')}
              />
              <TextInput
                label="Masquerade root"
                placeholder="/var/www/html"
                description="Static-files dir Caddy serves to non-authed probers"
                {...form.getInputProps('naiveMasquerade')}
              />
            </Stack>
          )}

          <Button type="submit" loading={loading} fullWidth>
            {isEdit ? 'Save changes' : 'Create inbound'}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}

function csvList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function numOr(v: number | '' | undefined, fallback: number): number {
  return v === '' || v === undefined ? fallback : Number(v);
}

function renameAwg(p: { jc: number; jmin: number; jmax: number; s1: number; s2: number; s3: number; s4: number }) {
  return {
    awgJc: p.jc,
    awgJmin: p.jmin,
    awgJmax: p.jmax,
    awgS1: p.s1,
    awgS2: p.s2,
    awgS3: p.s3,
    awgS4: p.s4,
  };
}
