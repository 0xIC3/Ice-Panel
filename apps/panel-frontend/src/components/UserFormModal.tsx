import {
  Button,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  type CreateUserInput,
  type ProtocolName,
  type TrafficLimitStrategy,
  type UpdateUserInput,
  type User,
} from '../lib/api';

const STRATEGY_OPTIONS: { value: TrafficLimitStrategy; label: string }[] = [
  { value: 'no_reset', label: 'No reset' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'rolling', label: 'Rolling 30 days' },
];

const PROTOCOL_OPTIONS: { value: ProtocolName; label: string }[] = [
  { value: 'hysteria', label: 'Hysteria2' },
  { value: 'xray', label: 'Xray (VLESS+REALITY)' },
  { value: 'amneziawg', label: 'AmneziaWG' },
  { value: 'naive', label: 'NaiveProxy' },
];

interface FormValues {
  username: string;
  trafficLimitGb: number | '';
  trafficLimitStrategy: TrafficLimitStrategy;
  expireDays: number | '';
  status: 'active' | 'disabled';
  description: string;
  tag: string;
  email: string;
  enabledProtocols: ProtocolName[];
}

function defaultValues(user: User | null): FormValues {
  return {
    username: user?.username ?? '',
    trafficLimitGb:
      user?.trafficLimitBytes != null ? Math.round(user.trafficLimitBytes / 1_073_741_824) : '',
    trafficLimitStrategy: user?.trafficLimitStrategy ?? 'no_reset',
    expireDays: '',
    status: (user?.status as 'active' | 'disabled') ?? 'active',
    description: user?.description ?? '',
    tag: user?.tag ?? '',
    email: user?.email ?? '',
    enabledProtocols: user?.enabledProtocols ?? ['hysteria'],
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  user: User | null; // null → create; non-null → edit
  onSubmit: (input: CreateUserInput | UpdateUserInput) => Promise<void>;
  loading?: boolean;
}

export function UserFormModal({ opened, onClose, user, onSubmit, loading }: Props) {
  const isEdit = user !== null;

  const form = useForm<FormValues>({
    initialValues: defaultValues(user),
    validate: {
      username: (v) => {
        if (isEdit) return null;
        if (v.length < 3) return 'Min 3 characters';
        if (!/^[a-zA-Z0-9_-]+$/.test(v)) return 'Letters, digits, underscore, hyphen only';
        return null;
      },
      email: (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'Invalid email' : null),
      enabledProtocols: (v) => (v.length === 0 ? 'Pick at least one protocol' : null),
    },
  });

  // Reset form when user prop changes (e.g. opening edit on different row).
  if (opened && form.values.username === '' && user !== null) {
    form.setValues(defaultValues(user));
  }

  async function handleSubmit(values: FormValues) {
    if (isEdit) {
      const input: UpdateUserInput = {
        status: values.status,
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb),
        trafficLimitStrategy: values.trafficLimitStrategy,
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        enabledProtocols: values.enabledProtocols,
      };
      await onSubmit(input);
    } else {
      const input: CreateUserInput = {
        username: values.username,
        trafficLimitGb: values.trafficLimitGb === '' ? null : Number(values.trafficLimitGb),
        trafficLimitStrategy: values.trafficLimitStrategy,
        expireDays: values.expireDays === '' ? null : Number(values.expireDays),
        description: values.description || null,
        tag: values.tag || null,
        email: values.email || null,
        enabledProtocols: values.enabledProtocols,
      };
      await onSubmit(input);
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
      title={isEdit ? `Edit ${user.username}` : 'Create user'}
      size="md"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label="Username"
            placeholder="alice"
            disabled={isEdit}
            required={!isEdit}
            {...form.getInputProps('username')}
          />

          {isEdit && (
            <Select
              label="Status"
              data={[
                { value: 'active', label: 'Active' },
                { value: 'disabled', label: 'Disabled' },
              ]}
              {...form.getInputProps('status')}
            />
          )}

          <NumberInput
            label="Traffic limit (GB)"
            placeholder="leave empty for unlimited"
            min={1}
            allowDecimal={false}
            allowNegative={false}
            {...form.getInputProps('trafficLimitGb')}
          />

          <Select
            label="Traffic reset strategy"
            data={STRATEGY_OPTIONS}
            {...form.getInputProps('trafficLimitStrategy')}
          />

          <MultiSelect
            label="Enabled protocols"
            description="Which protocols this user's subscription will include"
            data={PROTOCOL_OPTIONS}
            withCheckIcon
            {...form.getInputProps('enabledProtocols')}
          />

          {!isEdit && (
            <NumberInput
              label="Expires in (days)"
              placeholder="leave empty for no expiry"
              min={1}
              allowDecimal={false}
              allowNegative={false}
              {...form.getInputProps('expireDays')}
            />
          )}

          <TextInput
            label="Tag"
            placeholder="vip / trial / ..."
            {...form.getInputProps('tag')}
          />
          <TextInput
            label="Email"
            placeholder="user@example.com"
            {...form.getInputProps('email')}
          />
          <Textarea
            label="Description"
            placeholder="internal note"
            autosize
            minRows={2}
            maxRows={4}
            {...form.getInputProps('description')}
          />

          <Button type="submit" loading={loading} fullWidth>
            {isEdit ? 'Save changes' : 'Create user'}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
