import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pingDatabase } from './prisma.js';
import { pingRedis } from './lib/redis.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { nodesRoutes } from './modules/nodes/nodes.routes.js';
import { subscriptionRoutes } from './modules/subscription/subscription.routes.js';
import { srrRoutes } from './modules/srr/srr.routes.js';

/**
 * Build the Fastify instance with all plugins and routes registered.
 *
 * Side-effect-free: does not call `app.listen()`, does not start BullMQ workers,
 * and does not register cron jobs. The bootstrap (`index.ts`) wires those up.
 *
 * Tests use this directly with `app.inject(...)` for end-to-end HTTP coverage
 * without binding a port.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Invalid input',
        issues: error.issues,
      });
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send({
      error: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  app.get('/health', async () => {
    const [dbOk, redisOk] = await Promise.all([pingDatabase(), pingRedis()]);
    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'down',
      redis: redisOk ? 'ok' : 'down',
    };
  });

  await app.register(fastifyCors, {
    origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });

  await app.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    cache: 10000,
  });

  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
  });

  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(nodesRoutes);
  await app.register(subscriptionRoutes);
  await app.register(srrRoutes);

  return app;
}
