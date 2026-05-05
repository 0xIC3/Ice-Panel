import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as service from './subscription.service.js';
import { buildClashYaml } from './formats/clash.js';
import { buildSingboxJson } from './formats/singbox.js';
import { buildWgQuickConf } from './formats/wgconf.js';
import { buildXrayJson } from './formats/xrayjson.js';

const TokenParamSchema = z.object({
  token: z.string().min(8).max(128),
});

const FormatEnum = z.enum(['plain', 'json', 'clash', 'singbox', 'wgconf', 'xrayjson']);
type Format = z.infer<typeof FormatEnum>;

const QuerySchema = z.object({
  format: FormatEnum.optional(),
});

/**
 * Resolve which format the client wants. Explicit `?format=` always wins.
 * Otherwise we sniff the Accept header — `application/json` is the only
 * non-default we infer (legacy IcePath-VPN bot integration). Everything
 * else falls back to `plain` (base64 URI list — universal).
 */
function resolveFormat(
  query: z.infer<typeof QuerySchema>,
  acceptHeader: string,
): Format {
  if (query.format) return query.format;
  if (acceptHeader.toLowerCase().includes('application/json')) return 'json';
  return 'plain';
}

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  // GET /sub/:token — public (the token IS the credential).
  app.get('/sub/:token', async (request, reply) => {
    const params = TokenParamSchema.parse(request.params);
    const query = QuerySchema.parse(request.query);
    const format = resolveFormat(query, (request.headers.accept ?? '').toString());

    try {
      const result = await service.generateSubscription(params.token, {
        ip: request.ip,
        userAgent: typeof request.headers['user-agent'] === 'string'
          ? request.headers['user-agent']
          : null,
      });

      switch (format) {
        case 'json':
          return reply.type('application/json').send(result.json);
        case 'clash':
          return reply
            .type('text/yaml; charset=utf-8')
            .send(buildClashYaml(result.endpoints));
        case 'singbox':
          return reply
            .type('application/json')
            .send(buildSingboxJson(result.endpoints));
        case 'wgconf':
          return reply
            .type('text/plain; charset=utf-8')
            .send(buildWgQuickConf(result.endpoints));
        case 'xrayjson':
          return reply
            .type('application/json')
            .send(buildXrayJson(result.endpoints));
        case 'plain':
        default:
          return reply
            .type('text/plain; charset=utf-8')
            .send(result.textPlain);
      }
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
