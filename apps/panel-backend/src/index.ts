import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Worker } from 'bullmq';
import { config } from './config.js';
import { startCronTasksWorker, registerCronJobs } from './modules/scheduler/scheduler.queue.js';
import { prisma, pingDatabase } from './prisma.js';
import { pingRedis, closeRedis } from './lib/redis.js';
import { registerUserEventHandlers } from './modules/users/users.events.js';
import { startNodeUsersWorker } from './modules/users/users.queue.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
});

// Module-level worker reference so shutdown() can close it gracefully
let nodeUsersWorker: Worker | null = null;
let cronTasksWorker: Worker | null = null;

// ───── Global error handler ─────
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

// ───── Health ─────
app.get('/health', async () => {
  const [dbOk, redisOk] = await Promise.all([pingDatabase(), pingRedis()]);
  return {
    status: dbOk && redisOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'down',
    redis: redisOk ? 'ok' : 'down',
  };
});

// ───── Bootstrap ─────
async function start() {
  try {
    // 1. Verify infrastructure first
    const dbOk = await pingDatabase();
    if (!dbOk) {
      app.log.error('Cannot connect to database at startup');
      process.exit(1);
    }
    app.log.info('Database connection verified');

    const redisOk = await pingRedis();
    if (!redisOk) {
      app.log.error('Cannot connect to redis at startup');
      process.exit(1);
    }
    app.log.info('Redis connection verified');

    // 2. Wire event handlers + start workers (depend on Redis being up)
    registerUserEventHandlers();
    app.log.info('Event handlers registered');

    nodeUsersWorker = startNodeUsersWorker();
    cronTasksWorker = startCronTasksWorker();
    app.log.info('Workers started');
    await registerCronJobs();
    app.log.info('Cron jobs registered');

    // 3. Register Fastify plugins
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

    // 4. Register routes
    await app.register(authRoutes);
    await app.register(usersRoutes);

    // 5. Listen
    await app.listen({ port: config.APP_PORT, host: config.APP_HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown() {
  app.log.info('Shutting down...');
  await app.close();
  if (nodeUsersWorker) {
    await nodeUsersWorker.close();
  }
  if (cronTasksWorker) {
    await cronTasksWorker.close();
  }
  await prisma.$disconnect();
  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
