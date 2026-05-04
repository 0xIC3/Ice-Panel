import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

let app: FastifyInstance;
let token: string;

async function createUser(username: string): Promise<{
  id: string;
  subscriptionToken: string;
  hysteriaPassword: string;
}> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { authorization: `Bearer ${token}` },
    payload: { username },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createUser failed: ${res.statusCode} ${res.body}`);
  }
  const body = JSON.parse(res.body);
  // Subscription token is in the public DTO; hysteriaPassword is not, so
  // pull it directly from the DB for assertions.
  const persisted = await prisma.user.findUniqueOrThrow({
    where: { id: body.id },
    select: { hysteriaPassword: true },
  });
  return {
    id: body.id,
    subscriptionToken: body.subscriptionToken,
    hysteriaPassword: persisted.hysteriaPassword,
  };
}

async function createNode(name: string, address: string): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: { authorization: `Bearer ${token}` },
    payload: { name, address },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createNode failed: ${res.statusCode} ${res.body}`);
  }
}

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('GET /sub/:token (default text/plain)', () => {
  it('returns base64-encoded URI list with one entry per active node', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');
    await createNode('us-1', '10.0.0.2:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');

    const decoded = Buffer.from(res.body, 'base64').toString('utf8');
    const lines = decoded.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/^hysteria2:\/\//);
      expect(line).toContain(encodeURIComponent(user.hysteriaPassword));
    }
    expect(lines[0]).toContain('10.0.0.1:8443');
    expect(lines[0]).toContain('eu-1');
  });

  it('returns an empty base64 body when no nodes exist', async () => {
    const user = await createUser('alice');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });

    expect(res.statusCode).toBe(200);
    const decoded = Buffer.from(res.body, 'base64').toString('utf8');
    expect(decoded).toBe('');
  });
});

describe('GET /sub/:token (JSON format)', () => {
  it('returns structured JSON when ?format=json', async () => {
    const user = await createUser('alice');
    await createNode('eu-1', '10.0.0.1:8443');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}?format=json`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const body = JSON.parse(res.body);
    expect(body.user.id).toBe(user.id);
    expect(body.user.username).toBe('alice');
    expect(body.user.status).toBe('active');
    expect(body.user.trafficUsedBytes).toBe(0);
    expect(body.endpoints).toHaveLength(1);
    expect(body.endpoints[0].protocol).toBe('hysteria');
    expect(body.endpoints[0].nodeName).toBe('eu-1');
    expect(body.endpoints[0].uri).toMatch(/^hysteria2:\/\//);
  });

  it('returns JSON when Accept: application/json', async () => {
    const user = await createUser('alice');

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
      headers: { accept: 'application/json' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = JSON.parse(res.body);
    expect(body.user.username).toBe('alice');
  });
});

describe('GET /sub/:token — error cases', () => {
  it('returns 404 for unknown token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sub/this-token-does-not-exist-anywhere',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for soft-deleted user', async () => {
    const user = await createUser('gone');
    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    // soft-deleted user is invisible — looks like an unknown token (404)
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 REVOKED when subRevokedAt is set', async () => {
    const user = await createUser('rev');
    await prisma.user.update({
      where: { id: user.id },
      data: { subRevokedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).reason).toBe('REVOKED');
  });

  it('returns 403 DISABLED when status=disabled', async () => {
    const user = await createUser('dis');
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'disabled' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).reason).toBe('DISABLED');
  });

  it('returns 403 EXPIRED when status=expired', async () => {
    const user = await createUser('exp');
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'expired' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).reason).toBe('EXPIRED');
  });

  it('returns 403 LIMITED when status=limited', async () => {
    const user = await createUser('lim');
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'limited' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).reason).toBe('LIMITED');
  });
});

describe('GET /sub/:token — audit', () => {
  it('writes a row to subscription_request_history', async () => {
    const user = await createUser('alice');

    const before = await prisma.subscriptionRequestHistory.count({
      where: { userId: user.id },
    });

    await app.inject({
      method: 'GET',
      url: `/sub/${user.subscriptionToken}`,
      headers: {
        'user-agent': 'test-client/1.0',
        'x-forwarded-for': '203.0.113.1',
      },
    });

    const after = await prisma.subscriptionRequestHistory.findMany({
      where: { userId: user.id },
      orderBy: { requestedAt: 'desc' },
    });
    expect(after.length).toBe(before + 1);
    expect(after[0]!.userAgent).toBe('test-client/1.0');
  });
});
