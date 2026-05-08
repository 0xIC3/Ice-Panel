import { AppShell, Burger, Group, NavLink, Text, Button, Stack } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet, NavLink as RouterNavLink, useNavigate } from 'react-router-dom';
import {
  IconUsers,
  IconServer2,
  IconLogout,
  IconRoute,
  IconBolt,
  IconShield,
  IconLayoutDashboard,
  IconSettings,
} from '@tabler/icons-react';
import { useAuth } from '../stores/auth';

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const { admin, clearSession } = useAuth();

  function handleLogout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700} size="lg">
              Ice-Panel
            </Text>
          </Group>
          {admin && (
            <Text size="sm" c="dimmed">
              {admin.username}
            </Text>
          )}
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Stack justify="space-between" h="100%">
          <Stack gap={4}>
            <NavLink
              component={RouterNavLink}
              to="/"
              end
              label="Главная"
              leftSection={<IconLayoutDashboard size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/users"
              label="Users"
              leftSection={<IconUsers size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/profiles"
              label="Профили"
              leftSection={<IconBolt size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/squads"
              label="Squads"
              leftSection={<IconShield size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/nodes"
              label="Nodes"
              leftSection={<IconServer2 size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/srr"
              label="SRR"
              leftSection={<IconRoute size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/settings"
              label="Настройки"
              leftSection={<IconSettings size={18} />}
            />
          </Stack>
          <Button
            variant="subtle"
            leftSection={<IconLogout size={16} />}
            onClick={handleLogout}
          >
            Log out
          </Button>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
