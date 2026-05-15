import { Box, Button, PasswordInput, Stack, TextInput, Text, Loader, Center } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchAuthStatus, login, register, type LoginResponse } from '../lib/api';
import { useAuth } from '../stores/auth';
import { useBrandName } from '../hooks/useBrandName';

const HAIRLINE = '#1C2A3D';
const CARD = '#0F1A28';
const GROUND = '#08101A';
const SNOW = '#C8D4E3';
const MIST = '#7A8BA3';
const CYAN = '#7DD3FC';
const CYAN2 = '#67E8F9';
const MOSS = '#A7D8B9';

const DISPLAY = { fontFamily: "'Space Grotesk', Inter, sans-serif" };
const MONO_LABEL = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: MIST,
};

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuth((s) => s.setSession);
  const brandName = useBrandName();
  const { t } = useTranslation();

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
      <Center h="100%" style={{ backgroundColor: GROUND }}>
        <Loader color={CYAN} />
      </Center>
    );
  }

  const inputStyles = {
    label: { ...MONO_LABEL, marginBottom: 6 },
    input: {
      backgroundColor: GROUND,
      borderColor: HAIRLINE,
      color: SNOW,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 14,
      height: 46,
    },
  };

  return (
    <Box style={{ minHeight: '100vh', backgroundColor: GROUND, color: SNOW }}>
      {/* Top bar */}
      <Box
        style={{
          height: 76,
          borderBottom: `1px solid ${HAIRLINE}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 40px',
        }}
      >
        <Box style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <Box
            style={{
              width: 22,
              height: 22,
              background: `linear-gradient(135deg, ${CYAN}, ${CYAN2})`,
              transform: 'rotate(45deg)',
              borderRadius: 4,
              boxShadow: `0 0 14px ${CYAN}66`,
            }}
          />
          <Text
            style={{
              ...DISPLAY,
              fontWeight: 500,
              fontSize: 18,
              color: SNOW,
            }}
          >
            {brandName.toLowerCase()}
          </Text>
        </Box>
        <Box style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Text style={MONO_LABEL}>V1.0 · OPERATOR PANEL</Text>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: MOSS,
                boxShadow: `0 0 6px ${MOSS}99`,
              }}
            />
            <Text style={MONO_LABEL}>ALL SYSTEMS NORMAL</Text>
          </Box>
        </Box>
      </Box>

      {/* Content */}
      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: 80,
          padding: '120px 120px 80px',
          maxWidth: 1440,
          margin: '0 auto',
        }}
      >
        {/* Left: hero */}
        <Box>
          <Box style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: CYAN,
                boxShadow: `0 0 6px ${CYAN}99`,
              }}
            />
            <Text style={MONO_LABEL}>SIGN IN</Text>
          </Box>
          <Text
            style={{
              ...DISPLAY,
              fontSize: 96,
              fontWeight: 500,
              letterSpacing: '-0.03em',
              lineHeight: 1,
              color: SNOW,
              marginBottom: 32,
            }}
          >
            Operator
            <br />
            console.
          </Text>
          <Text
            style={{
              color: MIST,
              fontSize: 16,
              lineHeight: 1.55,
              maxWidth: 520,
              marginBottom: 60,
            }}
          >
            A multi-protocol panel that runs each protocol binary natively. Hysteria 2, Xray REALITY,
            AmneziaWG, NaiveProxy, MTProto, Shadowsocks 2022, Mieru — one operator dashboard.
          </Text>
          <Box style={{ borderTop: `1px solid ${HAIRLINE}`, paddingTop: 24, maxWidth: 520 }}>
            <Box style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 10 }}>
              <Text style={MONO_LABEL}>BUILD</Text>
              <Text style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: SNOW }}>
                v0.9.4 · 2026.05.14
              </Text>
              <Text style={MONO_LABEL}>REGION</Text>
              <Text style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: SNOW }}>
                SE · Aeza Stockholm
              </Text>
            </Box>
          </Box>
        </Box>

        {/* Right: form */}
        <Box>
          <Box
            style={{
              backgroundColor: CARD,
              border: `1px solid ${HAIRLINE}`,
              borderRadius: 14,
              padding: '32px 32px 28px',
              boxShadow: `0 20px 60px ${GROUND}cc`,
            }}
          >
            <Text style={{ ...MONO_LABEL, marginBottom: 8 }}>CREDENTIALS</Text>
            <Text
              style={{
                ...DISPLAY,
                fontSize: 24,
                fontWeight: 500,
                color: SNOW,
                marginBottom: 28,
                letterSpacing: '-0.01em',
              }}
            >
              {isBootstrap
                ? t('login.bootstrapTitle', { brand: brandName })
                : `Sign in to ${brandName}`}
            </Text>

            <form onSubmit={form.onSubmit((vals) => submitMutation.mutate(vals))}>
              <Stack gap="md">
                <TextInput
                  label={t('login.username')}
                  placeholder="admin"
                  autoComplete="username"
                  styles={inputStyles}
                  {...form.getInputProps('username')}
                />
                <PasswordInput
                  label={t('login.password')}
                  placeholder="••••••••"
                  autoComplete={isBootstrap ? 'new-password' : 'current-password'}
                  styles={inputStyles}
                  {...form.getInputProps('password')}
                />
                <Button
                  type="submit"
                  loading={submitMutation.isPending}
                  fullWidth
                  style={{
                    backgroundColor: CYAN,
                    color: GROUND,
                    fontWeight: 500,
                    height: 48,
                    fontSize: 13,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    marginTop: 4,
                  }}
                >
                  {isBootstrap ? t('login.submitRegister') : 'CONTINUE →'}
                </Button>
              </Stack>
            </form>

            <Box
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 20,
              }}
            >
              <Text style={{ color: MIST, fontSize: 12 }}>Passkey, Telegram, GitHub</Text>
              <Text style={MONO_LABEL}>SOON</Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
