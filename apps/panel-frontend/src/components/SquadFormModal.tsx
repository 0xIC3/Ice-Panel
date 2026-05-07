import { Alert, Button, Modal, MultiSelect, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconShieldLock } from '@tabler/icons-react';
import {
  ALL_SQUAD_ID,
  type CreateSquadInput,
  type Inbound,
  type Squad,
  type UpdateSquadInput,
} from '../lib/api';

interface FormValues {
  name: string;
  description: string;
  inboundIds: string[];
}

function defaultValues(squad: Squad | null): FormValues {
  return {
    name: squad?.name ?? '',
    description: squad?.description ?? '',
    inboundIds: squad?.inboundIds ?? [],
  };
}

interface Props {
  opened: boolean;
  onClose: () => void;
  squad: Squad | null;
  inbounds: Inbound[];
  onSubmit: (input: CreateSquadInput | UpdateSquadInput) => Promise<void>;
  loading?: boolean;
}

export function SquadFormModal({ opened, onClose, squad, inbounds, onSubmit, loading }: Props) {
  const isEdit = squad !== null;
  const isAllSquad = squad?.id === ALL_SQUAD_ID;

  const form = useForm<FormValues>({
    initialValues: defaultValues(squad),
    validate: {
      name: (v) =>
        v.length < 1 || !/^[A-Za-z0-9 _-]+$/.test(v)
          ? 'Letters, digits, space, underscore, hyphen'
          : null,
    },
  });

  // Sync form when opening edit on a different squad.
  if (opened && squad && form.values.name !== squad.name) {
    form.setValues(defaultValues(squad));
  }

  async function handleSubmit(values: FormValues) {
    const base = {
      name: values.name,
      description: values.description.trim() || null,
      inboundIds: values.inboundIds,
    };
    if (isEdit) {
      await onSubmit(base satisfies UpdateSquadInput);
    } else {
      await onSubmit(base satisfies CreateSquadInput);
    }
    onClose();
    form.reset();
  }

  const inboundOptions = inbounds.map((ib) => ({
    value: ib.id,
    label: `${ib.name} (${ib.protocol}:${ib.port})`,
  }));

  return (
    <Modal
      opened={opened}
      onClose={() => {
        form.reset();
        onClose();
      }}
      title={isEdit ? `Edit ${squad.name}` : 'Create squad'}
      size="md"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          {isAllSquad ? (
            <Alert color="yellow" icon={<IconShieldLock size={18} />}>
              The <b>All</b> squad is system-managed. It auto-tracks every inbound and
              receives every newly-created user. You can't rename it, change its
              inbound set, or delete it.
            </Alert>
          ) : null}

          <TextInput
            label="Name"
            placeholder="Trial / VIP / Stage"
            required
            disabled={isAllSquad}
            {...form.getInputProps('name')}
          />
          <Textarea
            label="Description"
            placeholder="Optional — what this squad is for"
            autosize
            minRows={2}
            disabled={isAllSquad}
            {...form.getInputProps('description')}
          />
          <MultiSelect
            label="Inbounds"
            description="Members of this squad see exactly these inbounds in their subscription."
            placeholder={isAllSquad ? 'Auto-managed' : 'Select inbounds…'}
            data={inboundOptions}
            disabled={isAllSquad}
            searchable
            {...form.getInputProps('inboundIds')}
          />
          {!isAllSquad ? (
            <Button type="submit" loading={loading} fullWidth>
              {isEdit ? 'Save changes' : 'Create squad'}
            </Button>
          ) : null}
        </Stack>
      </form>
    </Modal>
  );
}
