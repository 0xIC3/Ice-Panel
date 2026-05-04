import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from './auth.hook.js';
import { findAdminById } from '../admin/admin.service.js';
import { LoginSchema, RegisterSchema } from './auth.schemas.js';
import * as authService from './auth.service.js';
import * as adminService from '../admin/admin.service.js';
import { mapAdminToPublic } from '../admin/admin.mapper.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
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
      try {
        const admin = await authService.login(input);
        const token = await reply.jwtSign({
          sub: admin.id,
          role: admin.role,
        });
        return reply.send({
          admin: mapAdminToPublic(admin),
          token,
        });
      } catch (err) {
        if (err instanceof authService.InvalidCredentialsError) {
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
