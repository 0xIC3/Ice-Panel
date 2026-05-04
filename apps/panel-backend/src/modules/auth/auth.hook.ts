import type { FastifyRequest, FastifyReply } from 'fastify';
import { findAdminById } from '../admin/admin.service.js';

interface JwtSignPayload {
  sub: string;
  role: string;
}

interface JwtVerifiedPayload extends JwtSignPayload {
  iat: number;
  exp: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: {
      id: string;
      role: string;
    };
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtSignPayload;        // what we pass to reply.jwtSign(...)
    user: JwtVerifiedPayload;       // what request.user becomes after jwtVerify()
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing or invalid token' });
    return;
  }

  const payload = request.user;
  const admin = await findAdminById(payload.sub);
  if (!admin) {
    reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Admin no longer exists' });
    return;
  }

  request.admin = { id: admin.id, role: admin.role };
}
