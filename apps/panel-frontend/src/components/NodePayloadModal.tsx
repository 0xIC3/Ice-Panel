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
import { IconAlertTriangle, IconCheck, IconCopy, IconDownload } from '@tabler/icons-react';
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

  function handleDownload() {
    // Save as a single-line file. The node-installer's `--payload-file` /
    // `@/path` syntax reads this back without going through any TTY paste
    // buffer (Linux truncates terminal pastes at 4096 bytes; real payloads
    // are ~6-7 KB, so download-then-scp is the only reliable transfer).
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
      title={`Node "${nodeName}" — provisioning payload`}
      size="lg"
    >
      <Stack>
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          This payload contains the node's private mTLS key. It is shown <strong>only now</strong>.
          Save it securely. If lost, delete and re-create the node to mint a fresh one.
          <br />
          <br />
          <strong>Recommended:</strong> click <em>Download</em>, scp the file to your VPS, then
          install the node with{' '}
          <Code>install-node.sh --payload-file /path/to/file</Code>. Linux TTY canonical-mode
          truncates pasted strings at 4096 bytes — payloads are ~6-7 KB, so terminal-pasting
          will silently lose the tail.
        </Alert>

        <ScrollArea h={200} type="auto">
          <Code block style={{ wordBreak: 'break-all' }}>
            {payload}
          </Code>
        </ScrollArea>

        <Group justify="flex-end">
          <Button
            leftSection={<IconDownload size={16} />}
            variant="filled"
            onClick={handleDownload}
          >
            Download
          </Button>
          <Button
            leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            variant={copied ? 'filled' : 'light'}
            color={copied ? 'green' : undefined}
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button onClick={onClose} variant="default">
            I have saved it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
