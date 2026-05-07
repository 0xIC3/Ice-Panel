import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import { PermissiveUuid } from '../../lib/uuid-schema.js';
import * as svc from './api-tokens.service.js';

const CreateInput = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(z.string().max(64)).max(32).default([]),
});

const IdParam = z.object({ id: PermissiveUuid });

export async function apiTokensRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  app.get('/api/api-tokens', async (_req, reply) => {
    return reply.send({ tokens: await svc.listTokens() });
  });

  app.post('/api/api-tokens', async (req, reply) => {
    const input = CreateInput.parse(req.body);
    try {
      const { token, plaintext } = await svc.createToken(input.name, input.scopes);
      return reply.code(201).send({ ...token, token: plaintext });
    } catch (err) {
      if (err instanceof svc.ApiTokenNameTakenError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  app.delete('/api/api-tokens/:id', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    try {
      await svc.deleteToken(id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof svc.ApiTokenNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
