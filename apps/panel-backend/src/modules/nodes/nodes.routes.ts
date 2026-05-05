import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateNodeSchema,
  UpdateNodeSchema,
  ListNodesQuerySchema,
  NodeIdParamSchema,
} from './nodes.schemas.js';
import * as nodesService from './nodes.service.js';
import * as bootstrap from './bootstrap.service.js';

/**
 * Derive the panel URL the admin is currently using to talk to the API.
 * The bootstrap install command embeds this so the node knows where to
 * fetch its payload from. Falls back to the X-Forwarded-Proto / Host pair
 * when behind a reverse proxy (Caddy / Cloudflare).
 */
function publicUrlFromRequest(request: FastifyRequest): string {
  // Behind a TLS-terminating reverse proxy (Caddy / nginx / Cloudflare),
  // the `host` header carries the public hostname while `x-forwarded-proto`
  // carries the original scheme. If `x-forwarded-host` is present, default
  // proto to https — proxies that rewrite Host almost always terminate TLS.
  const xfHost = request.headers['x-forwarded-host']?.toString();
  const proto =
    request.headers['x-forwarded-proto']?.toString() ||
    (xfHost ? 'https' : (request as unknown as { protocol?: string }).protocol) ||
    'http';
  const host = xfHost || request.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

const BootstrapTokenParam = z.object({ token: z.string().regex(/^bs_[A-Za-z0-9_-]+$/).max(64) });
const auth = { onRequest: [requireAuth] };

export async function nodesRoutes(app: FastifyInstance): Promise<void> {
  // Public bootstrap-redeem route — the token IS the credential (single-use,
  // 15-min TTL). Per-route auth opt-in pattern matches auth.routes.ts and
  // avoids the addHook scope ambiguity that previously made this 401.
  app.get('/api/internal/bootstrap/:token', async (request, reply) => {
    const params = BootstrapTokenParam.parse(request.params);
    try {
      const payload = await bootstrap.redeemBootstrapToken(params.token);
      return reply.type('text/plain').send(payload);
    } catch (err) {
      if (err instanceof bootstrap.BootstrapTokenError) {
        return reply.code(err.httpStatus).send({
          error: err.reason,
          message: err.message,
        });
      }
      throw err;
    }
  });

  app.post('/api/nodes', auth, async (request, reply) => {
    const input = CreateNodeSchema.parse(request.body);
    try {
      const node = await nodesService.createNode(input, {
        panelUrl: publicUrlFromRequest(request),
      });
      return reply.code(201).send(node);
    } catch (err) {
      if (err instanceof nodesService.NodeAlreadyExistsError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  app.post('/api/nodes/:id/bootstrap', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    try {
      const node = await nodesService.getNodeById(params.id);
      const tokenInfo = await bootstrap.issueBootstrapToken(node.id);
      return reply.code(201).send({
        token: tokenInfo.token,
        expiresAt: tokenInfo.expiresAt.toISOString(),
        command: [
          'bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \\',
          `  --panel-url ${publicUrlFromRequest(request)} \\`,
          `  --bootstrap ${tokenInfo.token}`,
          '# Tip: append `--protocol xray` (or hysteria | amneziawg | naive) to skip the interactive prompt',
        ].join('\n'),
      });
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/nodes', auth, async (request, reply) => {
    const query = ListNodesQuerySchema.parse(request.query);
    return reply.send(await nodesService.listNodes(query));
  });

  app.get('/api/nodes/:id', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    try {
      return reply.send(await nodesService.getNodeById(params.id));
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.put('/api/nodes/:id', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    const input = UpdateNodeSchema.parse(request.body);
    try {
      return reply.send(await nodesService.updateNode(params.id, input));
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof nodesService.NodeAlreadyExistsError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  app.delete('/api/nodes/:id', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    try {
      await nodesService.deleteNode(params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
