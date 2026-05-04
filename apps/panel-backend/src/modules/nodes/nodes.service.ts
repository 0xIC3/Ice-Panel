import { issueNodeCert, encodeNodePayload } from '../keygen/keygen.service.js';
import * as repo from './nodes.repository.js';
import {
  mapNodeToPublic,
  mapNodeWithPayload,
  type PublicNodeDto,
  type CreateNodeResponseDto,
} from './nodes.mapper.js';
import type { CreateNodeInput, UpdateNodeInput, ListNodesQuery } from './nodes.schemas.js';

// ───── Domain errors ─────

export class NodeAlreadyExistsError extends Error {
  constructor(public field: 'name' | 'address', public value: string) {
    super(`Node with ${field} "${value}" already exists`);
    this.name = 'NodeAlreadyExistsError';
  }
}

export class NodeNotFoundError extends Error {
  constructor(public id: string) {
    super(`Node ${id} not found`);
    this.name = 'NodeNotFoundError';
  }
}

// ───── Helpers ─────

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function buildSans(address: string): { type: 'dns' | 'ip'; value: string }[] {
  const host = address.split(':')[0]!;
  return [{ type: IPV4_RE.test(host) ? 'ip' : 'dns', value: host }];
}

// ───── Service methods ─────

export async function createNode(input: CreateNodeInput): Promise<CreateNodeResponseDto> {
  const byName = await repo.findActiveByName(input.name);
  if (byName) throw new NodeAlreadyExistsError('name', input.name);

  const byAddress = await repo.findActiveByAddress(input.address);
  if (byAddress) throw new NodeAlreadyExistsError('address', input.address);

  const node = await repo.create({
    name: input.name,
    address: input.address,
    countryCode: input.countryCode ?? null,
    consumptionMultiplier: BigInt(input.consumptionMultiplier),
  });

  const cert = await issueNodeCert({
    commonName: input.name,
    sans: buildSans(input.address),
  });
  const payload = encodeNodePayload(cert);

  return mapNodeWithPayload(node, payload);
}

export async function listNodes(query: ListNodesQuery): Promise<{
  nodes: PublicNodeDto[];
  total: number;
  page: number;
  limit: number;
}> {
  const { nodes, total } = await repo.list(query);
  return {
    nodes: nodes.map(mapNodeToPublic),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getNodeById(id: string): Promise<PublicNodeDto> {
  const node = await repo.findActiveById(id);
  if (!node) throw new NodeNotFoundError(id);
  return mapNodeToPublic(node);
}

export async function updateNode(id: string, input: UpdateNodeInput): Promise<PublicNodeDto> {
  const existing = await repo.findActiveById(id);
  if (!existing) throw new NodeNotFoundError(id);

  if (input.name && input.name !== existing.name) {
    const dupe = await repo.findActiveByName(input.name);
    if (dupe) throw new NodeAlreadyExistsError('name', input.name);
  }
  if (input.address && input.address !== existing.address) {
    const dupe = await repo.findActiveByAddress(input.address);
    if (dupe) throw new NodeAlreadyExistsError('address', input.address);
  }

  const data: Parameters<typeof repo.updateById>[1] = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.address !== undefined) data.address = input.address;
  if (input.countryCode !== undefined) data.countryCode = input.countryCode;
  if (input.consumptionMultiplier !== undefined) {
    data.consumptionMultiplier = BigInt(input.consumptionMultiplier);
  }

  const updated = await repo.updateById(id, data);
  return mapNodeToPublic(updated);
}

export async function deleteNode(id: string): Promise<void> {
  const exists = await repo.existsActive(id);
  if (!exists) throw new NodeNotFoundError(id);
  await repo.softDelete(id);
}
