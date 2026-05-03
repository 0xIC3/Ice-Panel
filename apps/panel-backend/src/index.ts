import Fastify from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.js';
import { prisma, pingDatabase } from './prisma.js';
import { usersRoutes } from './modules/users/users.routes.js';

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
});

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
  const dbOk = await pingDatabase();
  return {
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'down',
  };
});

// ───── Bootstrap ─────
async function start() {
  try {
    const dbOk = await pingDatabase();
    if (!dbOk) {
      app.log.error('Cannot connect to database at startup');
      process.exit(1);
    }
    app.log.info('Database connection verified');

    await app.register(usersRoutes);

    await app.listen({ port: config.APP_PORT, host: config.APP_HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown() {
  app.log.info('Shutting down...');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
