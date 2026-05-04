import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateNodeSchema,
  UpdateNodeSchema,
  ListNodesQuerySchema,
  NodeIdParamSchema,
} from './nodes.schemas.js';
import * as nodesService from './nodes.service.js';

export async function nodesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  // POST /api/nodes — create a node and return the one-time payload
  app.post('/api/nodes', async (request, reply) => {
    const input = CreateNodeSchema.parse(request.body);
    try {
      const node = await nodesService.createNode(input);
      return reply.code(201).send(node);
    } catch (err) {
      if (err instanceof nodesService.NodeAlreadyExistsError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  // GET /api/nodes
  app.get('/api/nodes', async (request, reply) => {
    const query = ListNodesQuerySchema.parse(request.query);
    return reply.send(await nodesService.listNodes(query));
  });

  // GET /api/nodes/:id
  app.get('/api/nodes/:id', async (request, reply) => {
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

  // PUT /api/nodes/:id
  app.put('/api/nodes/:id', async (request, reply) => {
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

  // DELETE /api/nodes/:id
  app.delete('/api/nodes/:id', async (request, reply) => {
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
