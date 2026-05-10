import { AppShell, Burger, Group, NavLink, Text, Button, Stack } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet, NavLink as RouterNavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconUsers,
  IconServer2,
  IconLogout,
  IconRoute,
  IconBolt,
  IconShield,
  IconLayoutDashboard,
  IconListCheck,
  IconSettings,
} from '@tabler/icons-react';
import { useAuth } from '../stores/auth';
import { useBrandName } from '../hooks/useBrandName';
import { LanguageSwitcher } from './LanguageSwitcher';

export function AppLayout() {
  const [opened, { toggle }] = useDisclosure();
  const navigate = useNavigate();
  const { admin, clearSession } = useAuth();
  const brandName = useBrandName();
  const { t } = useTranslation();

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
              {brandName}
            </Text>
          </Group>
          <Group gap="md">
            <LanguageSwitcher />
            {admin && (
              <Text size="sm" c="dimmed">
                {admin.username}
              </Text>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <Stack justify="space-between" h="100%">
          <Stack gap={4}>
            <NavLink
              component={RouterNavLink}
              to="/"
              end
              label={t('sidebar.home')}
              leftSection={<IconLayoutDashboard size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/users"
              label={t('sidebar.users')}
              leftSection={<IconUsers size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/profiles"
              label={t('sidebar.profiles')}
              leftSection={<IconBolt size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/squads"
              label={t('sidebar.squads')}
              leftSection={<IconShield size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/nodes"
              label={t('sidebar.nodes')}
              leftSection={<IconServer2 size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/srr"
              label={t('sidebar.srr')}
              leftSection={<IconRoute size={18} />}
            />
            <NavLink
              href="/admin/queues"
              target="_blank"
              rel="noreferrer"
              label={t('sidebar.queues')}
              leftSection={<IconListCheck size={18} />}
            />
            <NavLink
              component={RouterNavLink}
              to="/settings"
              label={t('sidebar.settings')}
              leftSection={<IconSettings size={18} />}
            />
          </Stack>
          <Button
            variant="subtle"
            leftSection={<IconLogout size={16} />}
            onClick={handleLogout}
          >
            {t('sidebar.logout')}
          </Button>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
