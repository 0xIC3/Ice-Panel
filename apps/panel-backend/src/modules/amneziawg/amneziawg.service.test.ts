import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { generateUserCredentials } from '../../lib/credentials.js';
import {
  DEFAULT_SUBNET,
  IpExhaustedError,
  allocatePeer,
  getPeer,
  listPeers,
  releasePeer,
} from './amneziawg.service.js';

async function createNode(): Promise<string> {
  const node = await prisma.node.create({
    data: { name: 'eu-1', address: '10.0.0.1:8443' },
  });
  return node.id;
}

async function createInbound(nodeId: string, port = 51820): Promise<string> {
  const inbound = await prisma.inbound.create({
    data: {
      nodeId,
      protocol: 'amneziawg',
      name: 'awg0',
      port,
      config: { subnet: DEFAULT_SUBNET },
    },
  });
  return inbound.id;
}

async function createUser(username: string): Promise<string> {
  const creds = generateUserCredentials();
  const user = await prisma.user.create({
    data: {
      username,
      shortId: creds.shortId,
      subscriptionToken: creds.subscriptionToken,
      hysteriaPassword: creds.hysteriaPassword,
      naivePassword: creds.naivePassword,
      xrayUuid: creds.xrayUuid,
      amneziawgPrivateKey: creds.amneziawgPrivateKey,
      amneziawgPublicKey: creds.amneziawgPublicKey,
    },
  });
  return user.id;
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('allocatePeer', () => {
  it('hands out the lowest free IP starting at .2', async () => {
    const inboundId = await createInbound(await createNode());
    const u1 = await createUser('alice');
    const u2 = await createUser('bob');

    const a = await allocatePeer(inboundId, u1);
    const b = await allocatePeer(inboundId, u2);

    expect(a.ip).toBe('10.0.0.2');
    expect(b.ip).toBe('10.0.0.3');
  });

  it('is idempotent for the same (inbound, user)', async () => {
    const inboundId = await createInbound(await createNode());
    const u = await createUser('alice');

    const a = await allocatePeer(inboundId, u);
    const b = await allocatePeer(inboundId, u);

    expect(a.id).toBe(b.id);
    expect(a.ip).toBe(b.ip);
  });

  it('reuses gaps after a release', async () => {
    const inboundId = await createInbound(await createNode());
    const u1 = await createUser('alice');
    const u2 = await createUser('bob');
    const u3 = await createUser('carol');

    await allocatePeer(inboundId, u1); // .2
    const peer2 = await allocatePeer(inboundId, u2); // .3
    expect(peer2.ip).toBe('10.0.0.3');

    await releasePeer(inboundId, u2);
    const peer3 = await allocatePeer(inboundId, u3);
    expect(peer3.ip).toBe('10.0.0.3');
  });

  it('isolates allocations per inbound', async () => {
    const nodeId = await createNode();
    const ib1 = await createInbound(nodeId, 51820);
    const ib2 = await createInbound(nodeId, 51821);
    const u = await createUser('alice');

    const p1 = await allocatePeer(ib1, u);
    const p2 = await allocatePeer(ib2, u);

    expect(p1.ip).toBe('10.0.0.2');
    expect(p2.ip).toBe('10.0.0.2');
  });

  it('respects a custom subnet', async () => {
    const inboundId = await createInbound(await createNode());
    const u = await createUser('alice');

    const p = await allocatePeer(inboundId, u, '172.16.0.0/24');
    expect(p.ip).toBe('172.16.0.2');
  });

  it('throws IpExhaustedError when the range is full', async () => {
    const inboundId = await createInbound(await createNode());
    // /30 has 4 addresses, .0 net + .1 server + .3 broadcast → exactly one usable (.2)
    const u1 = await createUser('alice');
    const u2 = await createUser('bob');

    await allocatePeer(inboundId, u1, '10.99.0.0/30');
    await expect(
      allocatePeer(inboundId, u2, '10.99.0.0/30'),
    ).rejects.toBeInstanceOf(IpExhaustedError);
  });
});

describe('getPeer / listPeers / releasePeer', () => {
  it('returns null when no allocation exists', async () => {
    const inboundId = await createInbound(await createNode());
    const u = await createUser('alice');
    expect(await getPeer(inboundId, u)).toBeNull();
  });

  it('lists peers in IP order', async () => {
    const inboundId = await createInbound(await createNode());
    const u1 = await createUser('alice');
    const u2 = await createUser('bob');
    const u3 = await createUser('carol');

    await allocatePeer(inboundId, u2);
    await allocatePeer(inboundId, u1);
    await allocatePeer(inboundId, u3);

    const peers = await listPeers(inboundId);
    expect(peers.map((p) => p.ip)).toEqual(['10.0.0.2', '10.0.0.3', '10.0.0.4']);
  });

  it('release is a no-op when nothing is allocated', async () => {
    const inboundId = await createInbound(await createNode());
    const u = await createUser('alice');
    await expect(releasePeer(inboundId, u)).resolves.toBeUndefined();
  });
});
