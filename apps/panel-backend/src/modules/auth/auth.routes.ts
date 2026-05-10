import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from './auth.hook.js';
import { findAdminById } from '../admin/admin.service.js';
import { LoginSchema, RegisterSchema } from './auth.schemas.js';
import * as authService from './auth.service.js';
import * as adminService from '../admin/admin.service.js';
import { mapAdminToPublic } from '../admin/admin.mapper.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/telegram-notify.js';
import { loginAttempts } from '../../lib/metrics.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/auth/status — public discovery: tells the frontend which auth
  // methods are enabled and whether bootstrap registration is still open.
  app.get('/api/auth/status', async () => {
    const adminCount = await adminService.countAdmins();
    return {
      authentication: {
        password: { enabled: true },
      },
      registration: {
        enabled: adminCount === 0,
      },
    };
  });

  // POST /api/auth/login — strict rate limit (anti-brute-force)
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const input = LoginSchema.parse(request.body);
      const peerIp = request.ip;
      try {
        const admin = await authService.login(input);
        const token = await reply.jwtSign({
          sub: admin.id,
          role: admin.role,
        });
        // Slice 37 — also drop a same-origin cookie so server-rendered admin
        // tooling (Bull-board at /admin/queues) inherits the session without
        // requiring the SPA to manually copy localStorage to a header.
        // HttpOnly + SameSite=Strict — cookie is unreadable to JS and only
        // travels with first-party requests, so XSS can't exfil it and
        // CSRF can't ride it cross-site.
        reply.setCookie('ice_panel_auth', token, {
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
          maxAge: 60 * 60 * 24, // 24h — matches default JWT_EXPIRES_IN.
          secure: process.env.NODE_ENV === 'production',
        });
        notifyTelegramAsync(
          `🔓 *Admin login*\nuser: \`${escapeMarkdown(admin.username)}\`\nip: \`${escapeMarkdown(peerIp)}\``,
        );
        loginAttempts.inc({ result: 'ok' });
        return reply.send({
          admin: mapAdminToPublic(admin),
          token,
        });
      } catch (err) {
        if (err instanceof authService.AccountLockedError) {
          // 429 + Retry-After is the canonical lockout response. Body
          // discloses retryAfter so a friendly UI can countdown, but the
          // 401 vs 429 distinction also tells legit users they aren't
          // typing the wrong password — they're racing a stale lockout.
          loginAttempts.inc({ result: 'locked' });
          notifyTelegramAsync(
            `🔒 *Login locked out*\nuser: \`${escapeMarkdown(input.username)}\`\nip: \`${escapeMarkdown(peerIp)}\`\nretry in: ${err.retryAfterSeconds}s`,
          );
          reply.header('Retry-After', err.retryAfterSeconds.toString());
          return reply.code(429).send({
            error: 'ACCOUNT_LOCKED',
            message: err.message,
            retryAfterSeconds: err.retryAfterSeconds,
          });
        }
        if (err instanceof authService.InvalidCredentialsError) {
          loginAttempts.inc({ result: 'invalid' });
          return reply.code(401).send({
            error: 'INVALID_CREDENTIALS',
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  // POST /api/auth/register — bootstrap only (no admins exist) + strict rate limit
  app.post(
    '/api/auth/register',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '5 minutes',
        },
      },
    },
    async (request, reply) => {
      const adminCount = await adminService.countAdmins();
      if (adminCount > 0) {
        return reply.code(403).send({
          error: 'REGISTRATION_DISABLED',
          message: 'Registration is allowed only when no admins exist',
        });
      }

      const input = RegisterSchema.parse(request.body);
      try {
        const admin = await adminService.createAdmin(input);
        return reply.code(201).send(admin);
      } catch (err) {
        if (err instanceof adminService.AdminAlreadyExistsError) {
          return reply.code(409).send({
            error: 'CONFLICT',
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  // GET /api/auth/me — protected: returns current admin from JWT
  app.get(
    '/api/auth/me',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = await findAdminById(request.admin!.id);
      if (!admin) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Admin not found' });
      }
      return reply.send(mapAdminToPublic(admin));
    },
  );
}
