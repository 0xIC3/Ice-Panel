import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateInboundSchema,
  UpdateInboundSchema,
  ListInboundsQuerySchema,
  InboundIdParamSchema,
} from './inbounds.schemas.js';
import * as inboundsService from './inbounds.service.js';

export async function inboundsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  app.post('/api/inbounds', async (request, reply) => {
    const input = CreateInboundSchema.parse(request.body);
    try {
      const inbound = await inboundsService.createInbound(input);
      return reply.code(201).send(inbound);
    } catch (err) {
      if (err instanceof inboundsService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NODE_NOT_FOUND', message: err.message });
      }
      if (err instanceof inboundsService.PortInUseError) {
        return reply.code(409).send({ error: 'PORT_IN_USE', message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/inbounds', async (request, reply) => {
    const query = ListInboundsQuerySchema.parse(request.query);
    return reply.send({ inbounds: await inboundsService.listInbounds(query) });
  });

  app.get('/api/inbounds/:id', async (request, reply) => {
    const params = InboundIdParamSchema.parse(request.params);
    try {
      return reply.send(await inboundsService.getInboundById(params.id));
    } catch (err) {
      if (err instanceof inboundsService.InboundNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.put('/api/inbounds/:id', async (request, reply) => {
    const params = InboundIdParamSchema.parse(request.params);
    const input = UpdateInboundSchema.parse(request.body);
    try {
      return reply.send(await inboundsService.updateInbound(params.id, input));
    } catch (err) {
      if (err instanceof inboundsService.InboundNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof inboundsService.PortInUseError) {
        return reply.code(409).send({ error: 'PORT_IN_USE', message: err.message });
      }
      throw err;
    }
  });

  app.delete('/api/inbounds/:id', async (request, reply) => {
    const params = InboundIdParamSchema.parse(request.params);
    try {
      await inboundsService.deleteInbound(params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof inboundsService.InboundNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
