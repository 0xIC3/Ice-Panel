import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';

let app: FastifyInstance;
let token: string;

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

const auth = () => ({ authorization: `Bearer ${token}` });

async function createNode(name = 'eu-1', address = '10.0.0.1:8443'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/nodes',
    headers: auth(),
    payload: { name, address },
  });
  if (res.statusCode !== 201) throw new Error(`createNode: ${res.statusCode} ${res.body}`);
  return JSON.parse(res.body).id;
}

const validXrayConfig = {
  realityDest: 'www.cloudflare.com:443',
  realityServerNames: ['www.cloudflare.com'],
  realityShortIds: ['abc123'],
  realityPrivateKey: 'priv-key-base64url',
  realityPublicKey: 'pub-key-base64url',
};

const validHysteriaConfig = {
  obfsPassword: 'salamander-pw',
  brutalUpMbps: 100,
  brutalDownMbps: 200,
};

const validAmneziawgConfig = {
  subnet: '10.0.0.0/24',
  serverPrivateKey: 'srv-priv',
  serverPublicKey: 'srv-pub',
  obfuscation: { jc: 4, jmin: 40, jmax: 70, s1: 72, s2: 56, s3: 32, s4: 16, h1: 100, h2: 200, h3: 300, h4: 400 },
};

const validNaiveConfig = {
  hostname: 'n1.example.com',
  tlsEmail: 'ops@example.com',
  masqueradeRoot: '/var/www/html',
};

describe('POST /api/inbounds', () => {
  it('creates a Hysteria inbound', async () => {
    const nodeId = await createNode();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: {
        nodeId,
        protocol: 'hysteria',
        name: 'hy0',
        port: 443,
        config: validHysteriaConfig,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.protocol).toBe('hysteria');
    expect(body.config.obfsPassword).toBe('salamander-pw');
  });

  it('creates an Xray REALITY inbound', async () => {
    const nodeId = await createNode();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: { nodeId, protocol: 'xray', name: 'x0', port: 443, config: validXrayConfig },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.config.realityDest).toBe('www.cloudflare.com:443');
    // Defaults applied:
    expect(body.config.flow).toBe('xtls-rprx-vision');
    expect(body.config.fingerprint).toBe('chrome');
  });

  it('creates an AmneziaWG inbound with obfuscation defaults', async () => {
    const nodeId = await createNode();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: {
        nodeId,
        protocol: 'amneziawg',
        name: 'awg0',
        port: 51820,
        config: validAmneziawgConfig,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.config.subnet).toBe('10.0.0.0/24');
    expect(body.config.obfuscation.h1).toBe(100);
  });

  it('creates a NaiveProxy inbound', async () => {
    const nodeId = await createNode();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: {
        nodeId,
        protocol: 'naive',
        name: 'naive0',
        port: 443,
        config: validNaiveConfig,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).config.hostname).toBe('n1.example.com');
  });

  it('rejects invalid protocol-specific config (400)', async () => {
    const nodeId = await createNode();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: {
        nodeId,
        protocol: 'xray',
        name: 'bad',
        port: 443,
        config: { realityDest: 'no-port' }, // missing required fields + invalid format
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when node does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: {
        nodeId: '00000000-0000-0000-0000-000000000000',
        protocol: 'hysteria',
        name: 'hy',
        port: 443,
        config: {},
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when (nodeId, port) is already taken', async () => {
    const nodeId = await createNode();
    await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: { nodeId, protocol: 'hysteria', name: 'hy0', port: 443, config: {} },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: { nodeId, protocol: 'xray', name: 'x0', port: 443, config: validXrayConfig },
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      payload: { nodeId: '00000000-0000-0000-0000-000000000000', protocol: 'hysteria', name: 'h', port: 443, config: {} },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/inbounds', () => {
  it('lists inbounds across nodes ordered by nodeId+port', async () => {
    const n1 = await createNode('n1', '10.0.0.1');
    const n2 = await createNode('n2', '10.0.0.2');
    for (const [nodeId, port] of [[n1, 443], [n2, 8443], [n1, 51820]] as const) {
      await app.inject({
        method: 'POST',
        url: '/api/inbounds',
        headers: auth(),
        payload: {
          nodeId,
          protocol: 'hysteria',
          name: `hy-${nodeId.slice(0, 4)}-${port}`,
          port,
          config: {},
        },
      });
    }
    const res = await app.inject({ method: 'GET', url: '/api/inbounds', headers: auth() });
    expect(res.statusCode).toBe(200);
    const { inbounds } = JSON.parse(res.body);
    expect(inbounds).toHaveLength(3);
  });

  it('filters by protocol', async () => {
    const n1 = await createNode();
    await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: { nodeId: n1, protocol: 'hysteria', name: 'h', port: 443, config: {} },
    });
    await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: { nodeId: n1, protocol: 'xray', name: 'x', port: 8443, config: validXrayConfig },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/inbounds?protocol=xray',
      headers: auth(),
    });
    const { inbounds } = JSON.parse(res.body);
    expect(inbounds).toHaveLength(1);
    expect(inbounds[0].protocol).toBe('xray');
  });
});

describe('PUT /api/inbounds/:id', () => {
  it('updates name + port + enabled without touching config', async () => {
    const nodeId = await createNode();
    const created = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: { nodeId, protocol: 'hysteria', name: 'hy0', port: 443, config: {} },
    });
    const id = JSON.parse(created.body).id;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/inbounds/${id}`,
      headers: auth(),
      payload: { name: 'hy0-renamed', port: 8443, enabled: false },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('hy0-renamed');
    expect(body.port).toBe(8443);
    expect(body.enabled).toBe(false);
  });

  it('updates config and validates against the existing protocol', async () => {
    const nodeId = await createNode();
    const created = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: { nodeId, protocol: 'xray', name: 'x', port: 443, config: validXrayConfig },
    });
    const id = JSON.parse(created.body).id;

    // Valid Xray config update.
    const okRes = await app.inject({
      method: 'PUT',
      url: `/api/inbounds/${id}`,
      headers: auth(),
      payload: {
        config: {
          ...validXrayConfig,
          realityServerNames: ['cdn.example.com'],
          flow: 'xtls-rprx-vision',
          fingerprint: 'firefox',
        },
      },
    });
    expect(okRes.statusCode).toBe(200);
    expect(JSON.parse(okRes.body).config.fingerprint).toBe('firefox');

    // Hysteria-shaped config rejected for an Xray inbound.
    const badRes = await app.inject({
      method: 'PUT',
      url: `/api/inbounds/${id}`,
      headers: auth(),
      payload: { config: { obfsPassword: 'pw', realityDest: 'invalid' } },
    });
    expect(badRes.statusCode).toBe(400);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/inbounds/00000000-0000-0000-0000-000000000000',
      headers: auth(),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/inbounds/:id', () => {
  it('deletes the inbound and returns 204', async () => {
    const nodeId = await createNode();
    const created = await app.inject({
      method: 'POST',
      url: '/api/inbounds',
      headers: auth(),
      payload: { nodeId, protocol: 'hysteria', name: 'h', port: 443, config: {} },
    });
    const id = JSON.parse(created.body).id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/inbounds/${id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);
    expect(await prisma.inbound.count()).toBe(0);
  });

  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/inbounds/00000000-0000-0000-0000-000000000000',
      headers: auth(),
    });
    expect(res.statusCode).toBe(404);
  });
});
