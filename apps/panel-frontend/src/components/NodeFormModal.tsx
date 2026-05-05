import { Button, Modal, NumberInput, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { type CreateNodeInput, type Node, type UpdateNodeInput } from '../lib/api';

interface FormValues {
  name: string;
  address: string;
  countryCode: string;
  consumptionMultiplier: number | '';
}

function defaults(node: Node | null): FormValues {
  return {
    name: node?.name ?? '',
    address: node?.address ?? '',
    countryCode: node?.countryCode ?? '',
    consumptionMultiplier: node ? Number(node.consumptionMultiplier) : 1,
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  node: Node | null;
  onSubmit: (input: CreateNodeInput | UpdateNodeInput) => Promise<void>;
  loading?: boolean;
}

export function NodeFormModal({ opened, onClose, node, onSubmit, loading }: Props) {
  const isEdit = node !== null;

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
      countryCode: (v) =>
        v && !/^[A-Z]{2}$/.test(v) ? 'Two uppercase letters (ISO 3166-1)' : null,
    },
  });

  // When opening edit on a fresh row, sync form to that row.
  if (opened && node && form.values.name !== node.name) {
    form.setValues(defaults(node));
  }

  async function handleSubmit(values: FormValues) {
    const base = {
      name: values.name,
      address: values.address,
      countryCode: values.countryCode || null,
      consumptionMultiplier:
        values.consumptionMultiplier === '' ? 1 : Number(values.consumptionMultiplier),
    };
    if (isEdit) {
      await onSubmit(base satisfies UpdateNodeInput);
    } else {
      await onSubmit(base satisfies CreateNodeInput);
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
      title={isEdit ? `Edit ${node.name}` : 'Create node'}
      size="md"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label="Name"
            placeholder="eu-1"
            required
            {...form.getInputProps('name')}
          />
          <TextInput
            label="Address (host:port for panel mTLS)"
            placeholder="n1.example.com:8443"
            description="Control-plane address. Hysteria's public UDP port (443) is configured separately."
            required
            {...form.getInputProps('address')}
          />
          <TextInput
            label="Country code"
            placeholder="DE"
            maxLength={2}
            {...form.getInputProps('countryCode')}
          />
          <NumberInput
            label="Consumption multiplier"
            description="Traffic accounting factor (default 1)"
            min={1}
            allowDecimal={false}
            allowNegative={false}
            {...form.getInputProps('consumptionMultiplier')}
          />
          <Button type="submit" loading={loading} fullWidth>
            {isEdit ? 'Save changes' : 'Create node'}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
