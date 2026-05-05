import { Button, Center, Paper, PasswordInput, Stack, TextInput, Title, Text, Loader } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { fetchAuthStatus, login, register, type LoginResponse } from '../lib/api';
import { useAuth } from '../stores/auth';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);

  const statusQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: fetchAuthStatus,
    staleTime: 0,
  });

  const form = useForm({
    initialValues: { username: '', password: '' },
    validate: {
      username: (v) => (v.length < 3 ? 'Username must be at least 3 characters' : null),
      password: (v) => (v.length < 8 ? 'Password must be at least 8 characters' : null),
    },
  });

  const isBootstrap = statusQuery.data?.registration.enabled ?? false;

  const submitMutation = useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      if (isBootstrap) {
        await register(username, password);
      }
      return login(username, password);
    },
    onSuccess: (data: LoginResponse) => {
      setSession(data.token, data.admin);
      navigate('/users', { replace: true });
    },
    onError: (err) => {
      notifications.show({
        color: 'red',
        title: 'Sign-in failed',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    },
  });

  if (statusQuery.isLoading) {
    return (
      <Center h="100%">
        <Loader />
      </Center>
    );
  }

  return (
    <Center h="100%" p="md">
      <Paper withBorder shadow="md" p="xl" radius="md" w={360}>
        <Stack>
          <Stack gap={4}>
            <Title order={3}>{isBootstrap ? 'Create the first admin' : 'Ice-Panel sign in'}</Title>
            {isBootstrap && (
              <Text size="sm" c="dimmed">
                No admins exist yet. The first registration creates the bootstrap account.
              </Text>
            )}
          </Stack>

          <form onSubmit={form.onSubmit((vals) => submitMutation.mutate(vals))}>
            <Stack>
              <TextInput
                label="Username"
                placeholder="admin"
                autoComplete="username"
                {...form.getInputProps('username')}
              />
              <PasswordInput
                label="Password"
                placeholder="••••••••"
                autoComplete={isBootstrap ? 'new-password' : 'current-password'}
                {...form.getInputProps('password')}
              />
              <Button type="submit" loading={submitMutation.isPending} fullWidth>
                {isBootstrap ? 'Create admin & sign in' : 'Sign in'}
              </Button>
            </Stack>
          </form>
        </Stack>
      </Paper>
    </Center>
  );
}
