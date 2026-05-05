import { useState } from 'react';
import {
  Alert,
  Button,
  Code,
  Group,
  Modal,
  ScrollArea,
  Stack,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconCopy } from '@tabler/icons-react';
import { copyToClipboard } from '../lib/clipboard';

interface Props {
  opened: boolean;
  onClose: () => void;
  nodeName: string;
  payload: string;
}

/**
 * Shown exactly once after a successful node create. Displays the base64url
 * payload that includes the node's mTLS private key — the panel will not
 * surface it again on subsequent reads.
 */
export function NodePayloadModal({ opened, onClose, nodeName, payload }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await copyToClipboard(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('clipboard copy failed', err);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      closeOnClickOutside={false}
      closeOnEscape={false}
      title={`Node "${nodeName}" — provisioning payload`}
      size="lg"
    >
      <Stack>
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          This payload contains the node's private mTLS key. It is shown <strong>only now</strong>.
          Save it securely (e.g. paste into the node-agent's <Code>NODE_PAYLOAD</Code> env). If lost,
          delete and re-create the node to mint a fresh one.
        </Alert>

        <ScrollArea h={200} type="auto">
          <Code block style={{ wordBreak: 'break-all' }}>
            {payload}
          </Code>
        </ScrollArea>

        <Group justify="flex-end">
          <Button
            leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            variant={copied ? 'filled' : 'light'}
            color={copied ? 'green' : undefined}
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy payload'}
          </Button>
          <Button onClick={onClose} variant="default">
            I have saved it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
