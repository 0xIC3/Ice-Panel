import { z } from 'zod';
import type { Inbound } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import {
  PROTOCOL_CONFIG_SCHEMAS,
  type CreateInboundInput,
  type ListInboundsQuery,
  type UpdateInboundInput,
} from './inbounds.schemas.js';

export class InboundNotFoundError extends Error {
  constructor() {
    super('Inbound not found');
    this.name = 'InboundNotFoundError';
  }
}

export class NodeNotFoundError extends Error {
  constructor() {
    super('Node not found');
    this.name = 'NodeNotFoundError';
  }
}

export class PortInUseError extends Error {
  constructor(nodeId: string, port: number) {
    super(`Node ${nodeId} already has an inbound on port ${port}`);
    this.name = 'PortInUseError';
  }
}

export class ProtocolMismatchError extends Error {
  constructor() {
    super('config does not match the inbound protocol');
    this.name = 'ProtocolMismatchError';
  }
}

export async function createInbound(input: CreateInboundInput): Promise<Inbound> {
  const node = await prisma.node.findFirst({
    where: { id: input.nodeId, deletedAt: null },
    select: { id: true },
  });
  if (!node) throw new NodeNotFoundError();

  try {
    return await prisma.inbound.create({
      data: {
        nodeId: input.nodeId,
        protocol: input.protocol,
        name: input.name,
        port: input.port,
        enabled: input.enabled,
        config: input.config as never,
      },
    });
  } catch (err) {
    if (isUniquePortError(err)) {
      throw new PortInUseError(input.nodeId, input.port);
    }
    throw err;
  }
}

export async function listInbounds(query: ListInboundsQuery): Promise<Inbound[]> {
  return prisma.inbound.findMany({
    where: {
      nodeId: query.nodeId,
      protocol: query.protocol,
    },
    orderBy: [{ nodeId: 'asc' }, { port: 'asc' }],
  });
}

export async function getInboundById(id: string): Promise<Inbound> {
  const inbound = await prisma.inbound.findUnique({ where: { id } });
  if (!inbound) throw new InboundNotFoundError();
  return inbound;
}

export async function updateInbound(
  id: string,
  input: UpdateInboundInput,
): Promise<Inbound> {
  const existing = await prisma.inbound.findUnique({ where: { id } });
  if (!existing) throw new InboundNotFoundError();

  let validatedConfig: unknown;
  if (input.config !== undefined) {
    const schema = PROTOCOL_CONFIG_SCHEMAS[existing.protocol as keyof typeof PROTOCOL_CONFIG_SCHEMAS];
    if (!schema) {
      throw new ProtocolMismatchError();
    }
    const parsed = schema.safeParse(input.config);
    if (!parsed.success) {
      throw new z.ZodError(parsed.error.issues);
    }
    validatedConfig = parsed.data;
  }

  try {
    return await prisma.inbound.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        port: input.port ?? undefined,
        enabled: input.enabled ?? undefined,
        config: validatedConfig === undefined ? undefined : (validatedConfig as never),
      },
    });
  } catch (err) {
    if (isUniquePortError(err)) {
      throw new PortInUseError(existing.nodeId, input.port ?? existing.port);
    }
    throw err;
  }
}

export async function deleteInbound(id: string): Promise<void> {
  try {
    await prisma.inbound.delete({ where: { id } });
  } catch (err) {
    if (isRecordNotFound(err)) throw new InboundNotFoundError();
    throw err;
  }
}

function isUniquePortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

function isRecordNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}
