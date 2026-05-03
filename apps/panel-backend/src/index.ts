import Fastify from 'fastify';
import { config } from './config.js';
import { sql, pingDatabase } from './db.js';

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
});

app.get('/health', async () => {
  const dbOk = await pingDatabase();
  return {
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'down',
  };
});

async function start() {
  try {
    const dbOk = await pingDatabase();
    if (!dbOk) {
      app.log.error('Cannot connect to database at startup');
      process.exit(1);
    }
    app.log.info('Database connection verified');

    await app.listen({ port: config.APP_PORT, host: config.APP_HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

async function shutdown() {
  app.log.info('Shutting down...');
  await app.close();
  await sql.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
