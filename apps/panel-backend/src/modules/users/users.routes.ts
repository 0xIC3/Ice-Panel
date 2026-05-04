import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  CreateUserSchema,
  UpdateUserSchema,
  ListUsersQuerySchema,
  UserIdParamSchema,
} from './users.schemas.js';
import * as usersService from './users.service.js';

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  // All /api/users/* require authenticated admin
  app.addHook('onRequest', requireAuth);
  // POST /api/users
  app.post('/api/users', async (request, reply) => {
    const input = CreateUserSchema.parse(request.body);
    try {
      const user = await usersService.createUser(input);
      return reply.code(201).send(user);
    } catch (err) {
      if (err instanceof usersService.UserAlreadyExistsError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  // GET /api/users
  app.get('/api/users', async (request, reply) => {
    const query = ListUsersQuerySchema.parse(request.query);
    const result = await usersService.listUsers(query);
    return reply.send(result);
  });

  // GET /api/users/:id
  app.get('/api/users/:id', async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    try {
      const user = await usersService.getUserById(params.id);
      return reply.send(user);
    } catch (err) {
      if (err instanceof usersService.UserNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // PUT /api/users/:id
  app.put('/api/users/:id', async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    const input  = UpdateUserSchema.parse(request.body);
    try {
      const user = await usersService.updateUser(params.id, input);
      return reply.send(user);
    } catch (err) {
      if (err instanceof usersService.UserNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // DELETE /api/users/:id
  app.delete('/api/users/:id', async (request, reply) => {
    const params = UserIdParamSchema.parse(request.params);
    try {
      await usersService.deleteUser(params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof usersService.UserNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
