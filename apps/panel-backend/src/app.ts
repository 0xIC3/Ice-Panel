import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCompress from '@fastify/compress';
import fastifyCookie from '@fastify/cookie';
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
// Slice 27 — `inboundsRoutes` retired. The new /api/profiles + /api/bindings
// pair from `profilesRoutes` replaces it. The inbounds module file is kept
// in the tree for now because its config schemas are reused by profiles, but
// no routes are mounted.
// import { inboundsRoutes } from './modules/inbounds/inbounds.routes.js';
import { squadsRoutes } from './modules/squads/squads.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { profilesRoutes } from './modules/profiles/profiles.routes.js';
import { hostsRoutes } from './modules/hosts/hosts.routes.js';
import { hwidRoutes } from './modules/hwid/hwid.routes.js';
import { regionsRoutes } from './modules/regions/regions.routes.js';
import { testConnectRoutes } from './modules/test-connect/test-connect.routes.js';
import { apiTokensRoutes } from './modules/api-tokens/api-tokens.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { bullBoardRoutes } from './modules/admin/bull-board.routes.js';

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
    // Trust X-Forwarded-For / X-Real-IP headers from the reverse proxy in
    // front of the panel (Caddy / nginx in our default setup, optionally
    // with Cloudflare further upstream). Without this `request.ip` reports
    // the proxy's IP, which would garble audit logs, rate-limit keys, and
    // any IP-based heuristics. The frontend nginx and Cloudflare both set
    // these headers, so a hop count of 2 is safe; we don't accept the
    // header from arbitrary clients.
    trustProxy: 2,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      // Log the issues to stdout so admins can see *which field* failed
      // without needing to open browser DevTools — caught by request log
      // but with full issue array (path + message + code per offending
      // field) instead of just `statusCode: 400`.
      request.log.warn(
        { url: request.url, issues: error.issues },
        'Zod validation failed',
      );
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

  // Compress JSON responses ≥1 KB. Dashboard overview is the obvious target —
  // the per-node metrics + nodes table + events array runs ~12 KB and gzips
  // to ~2 KB. Below threshold (small lists, error bodies) we skip compression
  // to avoid the CPU/latency cost on responses where the savings are noise.
  //
  // Restricted to application/json so subscription URIs (text/plain, YAML,
  // wgconf) stay raw — those clients are mobile VPN apps that don't always
  // negotiate Accept-Encoding correctly, and the payloads are small.
  //
  // Skipped under NODE_ENV=test: vitest's app.inject() advertises
  // Accept-Encoding but light-my-request doesn't auto-decode the response,
  // so compressed bodies look like gibberish to JSON.parse. The compression
  // win is a production concern anyway.
  if (config.NODE_ENV !== 'test') {
    await app.register(fastifyCompress, {
      global: true,
      encodings: ['gzip', 'deflate'],
      threshold: 1024,
      customTypes: /^application\/json$/,
    });
  }

  await app.register(fastifyCors, {
    origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
    // Explicit methods — `@fastify/cors` defaults to GET/HEAD/POST only,
    // which silently breaks DELETE/PUT mutations from the SPA (browser
    // CORS preflight rejects them). Caught the first time admin tried to
    // delete a user via the UI.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    cache: 10000,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
    // Slice 37 — also accept the JWT via cookie so server-rendered tools
    // mounted on the panel origin (Bull-board UI at /admin/queues) can be
    // gated behind requireAuth without copy-pasting tokens. The SPA sets
    // this cookie on login alongside its localStorage copy.
    cookie: {
      cookieName: 'ice_panel_auth',
      signed: false,
    },
  });

  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(nodesRoutes);
  await app.register(subscriptionRoutes);
  await app.register(srrRoutes);
  await app.register(squadsRoutes);
  await app.register(dashboardRoutes);
  await app.register(profilesRoutes);
  await app.register(hostsRoutes);
  await app.register(hwidRoutes);
  await app.register(regionsRoutes);
  await app.register(testConnectRoutes);
  await app.register(apiTokensRoutes);
  await app.register(settingsRoutes);
  await app.register(bullBoardRoutes);

  return app;
}
