import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Collapse,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconChevronDown, IconCopy, IconDownload } from '@tabler/icons-react';
import { copyToClipboard } from '../lib/clipboard';

interface BootstrapInfo {
  token: string;
  expiresAt: string;
  command: string;
}

interface Props {
  opened: boolean;
  onClose: () => void;
  nodeName: string;
  payload: string;
  bootstrap?: BootstrapInfo;
}

/**
 * Shown exactly once after a successful node create. Two flows are offered:
 *
 *   1. Bootstrap-token (recommended) — short command that the admin pastes
 *      on the node; install-script curls the panel for the full payload.
 *      Sidesteps the 4 KB Linux TTY paste limit.
 *
 *   2. Manual / file (fallback) — full base64 payload shown for download.
 *      Admin scp's the file to the node and runs install-script with
 *      `--payload-file /path/to/file`. Useful for air-gapped setups or
 *      when the node can't reach the panel HTTP endpoint at install time.
 */
export function NodePayloadModal({ opened, onClose, nodeName, payload, bootstrap }: Props) {
  const [copiedKey, setCopiedKey] = useState<'cmd' | 'payload' | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function handleCopy(key: 'cmd' | 'payload', value: string) {
    try {
      await copyToClipboard(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('clipboard copy failed', err);
    }
  }

  function handleDownload() {
    const blob = new Blob([payload], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nodeName}-payload.b64`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      closeOnClickOutside={false}
      closeOnEscape={false}
      title={`Node "${nodeName}" — provisioning`}
      size="lg"
    >
      <Stack>
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          This token grants the node-installer one-time access to mint a private
          mTLS key. The panel won't surface it again on subsequent reads —
          if the token expires before you redeem it, click{' '}
          <em>Refresh bootstrap</em> on the node row.
        </Alert>

        {bootstrap ? (
          <>
            <Stack gap={4}>
              <Group justify="space-between">
                <Text fw={600}>Bootstrap token</Text>
                <Badge color="blue" variant="light">
                  expires {new Date(bootstrap.expiresAt).toLocaleTimeString()}
                </Badge>
              </Group>
              <Code style={{ wordBreak: 'break-all' }}>{bootstrap.token}</Code>
            </Stack>

            <Stack gap={4}>
              <Text fw={600}>Run on the node</Text>
              <Text size="xs" c="dimmed">
                Replace <Code>&lt;xray|hysteria|…&gt;</Code> with the protocol you want, then
                paste this single command on the VPS over SSH:
              </Text>
              <ScrollArea h={120} type="auto">
                <Code block style={{ whiteSpace: 'pre' }}>
                  {bootstrap.command}
                </Code>
              </ScrollArea>
              <Group>
                <Button
                  leftSection={copiedKey === 'cmd' ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  color={copiedKey === 'cmd' ? 'green' : undefined}
                  variant={copiedKey === 'cmd' ? 'filled' : 'light'}
                  onClick={() => handleCopy('cmd', bootstrap.command)}
                >
                  {copiedKey === 'cmd' ? 'Copied' : 'Copy command'}
                </Button>
              </Group>
            </Stack>
          </>
        ) : null}

        <Divider />

        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600}>Manual / file flow (advanced)</Text>
            <Button
              variant="subtle"
              size="compact-sm"
              rightSection={<IconChevronDown size={14} />}
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? 'Hide' : 'Show'} raw payload
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Use this if the node can't reach the panel HTTP endpoint at install time
            (air-gapped, deployed behind a strict firewall, etc). Download the file,
            scp to the node, run <Code>install-node.sh --payload-file /path</Code>.
          </Text>
          <Collapse in={showRaw}>
            <ScrollArea h={160} type="auto" mt="xs">
              <Code block style={{ wordBreak: 'break-all' }}>
                {payload}
              </Code>
            </ScrollArea>
          </Collapse>
          <Group mt="xs">
            <Button
              leftSection={<IconDownload size={16} />}
              variant="light"
              onClick={handleDownload}
            >
              Download payload
            </Button>
            <Button
              leftSection={copiedKey === 'payload' ? <IconCheck size={16} /> : <IconCopy size={16} />}
              variant={copiedKey === 'payload' ? 'filled' : 'light'}
              color={copiedKey === 'payload' ? 'green' : undefined}
              onClick={() => handleCopy('payload', payload)}
            >
              {copiedKey === 'payload' ? 'Copied' : 'Copy payload'}
            </Button>
          </Group>
        </Stack>

        <Group justify="flex-end" mt="md">
          <Button onClick={onClose} variant="filled">
            I have saved it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
