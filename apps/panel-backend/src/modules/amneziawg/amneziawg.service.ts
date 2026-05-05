import type { AmneziawgPeer } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { intToIp, ipToInt, parseSubnet } from './amneziawg.subnet.js';

export const DEFAULT_SUBNET = '10.0.0.0/24';

export class IpExhaustedError extends Error {
  constructor(
    public readonly inboundId: string,
    public readonly subnet: string,
  ) {
    super(`No free IPs left in ${subnet} for inbound ${inboundId}`);
    this.name = 'IpExhaustedError';
  }
}

export async function getPeer(
  inboundId: string,
  userId: string,
): Promise<AmneziawgPeer | null> {
  return prisma.amneziawgPeer.findUnique({
    where: { inboundId_userId: { inboundId, userId } },
  });
}

export async function listPeers(inboundId: string): Promise<AmneziawgPeer[]> {
  const rows = await prisma.amneziawgPeer.findMany({ where: { inboundId } });
  return rows.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));
}

/**
 * Allocate a stable IP for (inbound, user). Idempotent — returns the existing
 * row if one is already there. Picks the lowest unused address inside the
 * subnet (skipping network, server, and broadcast).
 *
 * Race-safe via the UNIQUE(inbound_id, ip) constraint: a concurrent allocator
 * that grabs our chosen IP triggers a P2002, we re-scan and try the next free
 * slot. A concurrent allocator for the same user collapses to the existing row
 * via UNIQUE(inbound_id, user_id).
 */
export async function allocatePeer(
  inboundId: string,
  userId: string,
  subnet: string = DEFAULT_SUBNET,
): Promise<AmneziawgPeer> {
  const range = parseSubnet(subnet);
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const existing = await getPeer(inboundId, userId);
    if (existing) return existing;

    const taken = new Set(
      (await listPeers(inboundId)).map((p) => ipToInt(p.ip)),
    );
    let free: number | null = null;
    for (let n = range.firstUsable; n <= range.lastUsable; n++) {
      if (!taken.has(n)) {
        free = n;
        break;
      }
    }
    if (free === null) throw new IpExhaustedError(inboundId, subnet);

    try {
      return await prisma.amneziawgPeer.create({
        data: { inboundId, userId, ip: intToIp(free) },
      });
    } catch {
      // P2002 on either UNIQUE — loop will pick existing or next free.
    }
  }
  throw new Error(
    `Failed to allocate amneziawg peer for inbound ${inboundId} after ${maxAttempts} attempts`,
  );
}

export async function releasePeer(
  inboundId: string,
  userId: string,
): Promise<void> {
  await prisma.amneziawgPeer.deleteMany({ where: { inboundId, userId } });
}
