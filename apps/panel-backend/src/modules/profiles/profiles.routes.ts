import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import {
  BindingIdParamSchema,
  CreateBindingSchema,
  CreateProfileSchema,
  ListBindingsQuerySchema,
  ListProfilesQuerySchema,
  ProfileIdParamSchema,
  UpdateBindingSchema,
  UpdateProfileSchema,
} from './profiles.schemas.js';
import * as svc from './profiles.service.js';

export async function profilesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', requireAuth);

  // ───── Profiles ─────

  app.post('/api/profiles', async (req, reply) => {
    const input = CreateProfileSchema.parse(req.body);
    try {
      const p = await svc.createProfile(input);
      return reply.code(201).send(p);
    } catch (err) {
      if (err instanceof svc.ProfileNameTakenError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/profiles', async (req, reply) => {
    const q = ListProfilesQuerySchema.parse(req.query);
    return reply.send({ profiles: await svc.listProfiles(q) });
  });

  app.get('/api/profiles/:id', async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    try {
      return reply.send(await svc.getProfileById(id));
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.put('/api/profiles/:id', async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    const input = UpdateProfileSchema.parse(req.body);
    try {
      return reply.send(await svc.updateProfile(id, input));
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof svc.ProfileNameTakenError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  app.delete('/api/profiles/:id', async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    try {
      await svc.deleteProfile(id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // ───── Bindings ─────

  app.post('/api/bindings', async (req, reply) => {
    const input = CreateBindingSchema.parse(req.body);
    try {
      const b = await svc.createBinding(input);
      return reply.code(201).send(b);
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError || err instanceof svc.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (
        err instanceof svc.PortInUseError ||
        err instanceof svc.NodeAlreadyBoundError
      ) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/bindings', async (req, reply) => {
    const q = ListBindingsQuerySchema.parse(req.query);
    return reply.send({ bindings: await svc.listBindings(q) });
  });

  app.get('/api/bindings/:id', async (req, reply) => {
    const { id } = BindingIdParamSchema.parse(req.params);
    try {
      return reply.send(await svc.getBindingById(id));
    } catch (err) {
      if (err instanceof svc.BindingNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.put('/api/bindings/:id', async (req, reply) => {
    const { id } = BindingIdParamSchema.parse(req.params);
    const input = UpdateBindingSchema.parse(req.body);
    try {
      return reply.send(await svc.updateBinding(id, input));
    } catch (err) {
      if (err instanceof svc.BindingNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof svc.PortInUseError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  app.delete('/api/bindings/:id', async (req, reply) => {
    const { id } = BindingIdParamSchema.parse(req.params);
    try {
      await svc.deleteBinding(id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof svc.BindingNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
