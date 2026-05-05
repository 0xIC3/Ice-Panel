import {
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  ScrollArea,
  Stack,
} from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconCopy } from '@tabler/icons-react';

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
          <CopyButton value={payload} timeout={1500}>
            {({ copied, copy }) => (
              <Button
                leftSection={
                  copied ? <IconCheck size={16} /> : <IconCopy size={16} />
                }
                variant={copied ? 'filled' : 'light'}
                color={copied ? 'green' : undefined}
                onClick={copy}
              >
                {copied ? 'Copied' : 'Copy payload'}
              </Button>
            )}
          </CopyButton>
          <Button onClick={onClose} variant="default">
            I have saved it
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
