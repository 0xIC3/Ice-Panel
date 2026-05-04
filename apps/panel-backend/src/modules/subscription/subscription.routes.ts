import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as service from './subscription.service.js';

const TokenParamSchema = z.object({
  token: z.string().min(8).max(128),
});

const QuerySchema = z.object({
  format: z.enum(['json', 'plain']).optional(),
});

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  // GET /sub/:token — public (the token IS the credential)
  app.get('/sub/:token', async (request, reply) => {
    const params = TokenParamSchema.parse(request.params);
    const query = QuerySchema.parse(request.query);

    const acceptHeader = (request.headers.accept ?? '').toLowerCase();
    const wantJson = query.format === 'json' || acceptHeader.includes('application/json');

    try {
      const result = await service.generateSubscription(params.token, {
        ip: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : null,
      });
      if (wantJson) {
        return reply.type('application/json').send(result.json);
      }
      return reply.type('text/plain; charset=utf-8').send(result.textPlain);
    } catch (err) {
      if (err instanceof service.SubscriptionNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof service.SubscriptionForbiddenError) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: err.message,
          reason: err.reason,
        });
      }
      throw err;
    }
  });
}
