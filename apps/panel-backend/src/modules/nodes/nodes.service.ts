import { randomBytes } from 'node:crypto';
import { issueNodeCert, encodeNodePayload } from '../keygen/keygen.service.js';
import { eventBus } from '../../lib/event-bus.js';
import { prisma } from '../../prisma.js';
import * as repo from './nodes.repository.js';
import { issueBootstrapToken } from './bootstrap.service.js';
import {
  mapNodeToPublic,
  mapNodeWithPayload,
  type PublicNodeDto,
  type CreateNodeResponseDto,
  type BootstrapInfo,
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

export interface CreateNodeContext {
  /** Public URL of the panel as seen by the admin browser (used to render
   *  the bootstrap install command — node will hit this URL to fetch payload). */
  panelUrl: string;
}

export async function createNode(
  input: CreateNodeInput,
  ctx: CreateNodeContext,
): Promise<CreateNodeResponseDto> {
  // App-level checks against active (non-soft-deleted) rows.
  const byName = await repo.findActiveByName(input.name);
  if (byName) throw new NodeAlreadyExistsError('name', input.name);

  const byAddress = await repo.findActiveByAddress(input.address);
  if (byAddress) throw new NodeAlreadyExistsError('address', input.address);

  let node;
  try {
    node = await repo.create({
      name: input.name,
      address: input.address,
      protocol: input.protocol,
      countryCode: input.countryCode ?? null,
      consumptionMultiplier: BigInt(input.consumptionMultiplier),
      regionId: input.regionId ?? null,
      maxUsers: input.maxUsers ?? null,
      // Slice 38 — heartbeat-self-destruct secret. 32 bytes of entropy is
      // overkill for HMAC-SHA256 keying, but stays well under the 64-byte
      // block size and matches our convention for symmetric secrets.
      heartbeatSecret: randomBytes(32),
    });
  } catch (err) {
    // Catch DB-level UNIQUE violation. Soft-deleted rows still hold the
    // unique value at the DB level — the app-level checks above only see
    // active rows, so a soft-deleted node with the same name/address
    // surfaces here as P2002. Slice 24 will replace these with partial
    // unique indexes (`WHERE deleted_at IS NULL`); until then we map the
    // raw error to a friendly 409.
    if (isUniqueViolation(err)) {
      const target = ((err as { meta?: { target?: string[] | string } }).meta?.target ?? '') as
        | string
        | string[];
      const flat = Array.isArray(target) ? target.join(',') : target;
      const field: 'name' | 'address' = flat.includes('address') ? 'address' : 'name';
      throw new NodeAlreadyExistsError(field, field === 'address' ? input.address : input.name);
    }
    throw err;
  }

  const cert = await issueNodeCert({
    commonName: input.name,
    sans: buildSans(input.address),
  });
  const payload = encodeNodePayload(cert);

  const tokenInfo = await issueBootstrapToken(node.id);
  const bootstrap: BootstrapInfo = {
    token: tokenInfo.token,
    expiresAt: tokenInfo.expiresAt.toISOString(),
    command: renderBootstrapCommand(ctx.panelUrl, tokenInfo.token, node.protocol),
  };

  // Trigger backfill so existing active users land on this fresh node.
  // Without this, addUser only fires on future user.created events; admins
  // would have to recreate every existing user, which we hit live during the
  // 2026-05-06 VPS test (Hysteria auth rejected pre-existing user).
  eventBus.emit('node.created', { nodeId: node.id, nodeName: node.name });

  return mapNodeWithPayload(node, payload, bootstrap);
}

function renderBootstrapCommand(panelUrl: string, token: string, protocol: string): string {
  // Slice S7 — embed --panel-ip if PANEL_PUBLIC_IP is configured so the
  // agent's UFW locks :8443/tcp to the panel's origin. When unset we
  // emit a literal placeholder; the admin must fill it in by hand or
  // accept world-open mTLS port (with a loud warn from install-node.sh).
  const panelIp = (process.env.PANEL_PUBLIC_IP ?? '').trim();
  const lines = [
    'bash <(curl -fsSL https://raw.githubusercontent.com/0xIC3/Ice-Panel/main/scripts/install-node.sh) \\',
    `  --panel-url ${panelUrl} \\`,
    `  --bootstrap ${token} \\`,
    `  --protocol ${protocol}`,
  ];
  if (panelIp) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --panel-ip ${panelIp}`);
  } else {
    lines[lines.length - 1] += ' \\';
    lines.push('  --panel-ip <YOUR_PANEL_PUBLIC_IP>  # set PANEL_PUBLIC_IP env to inject this automatically');
  }
  return lines.join('\n');
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
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
  if (input.protocol !== undefined) data.protocol = input.protocol;
  if (input.countryCode !== undefined) data.countryCode = input.countryCode;
  if (input.consumptionMultiplier !== undefined) {
    data.consumptionMultiplier = BigInt(input.consumptionMultiplier);
  }
  if (input.regionId !== undefined) data.regionId = input.regionId;
  if (input.maxUsers !== undefined) data.maxUsers = input.maxUsers;

  const updated = await repo.updateById(id, data);
  return mapNodeToPublic(updated);
}

export async function deleteNode(id: string): Promise<void> {
  const exists = await repo.existsActive(id);
  if (!exists) throw new NodeNotFoundError(id);
  // Hard-cascade profile bindings (and their hosts via FK cascade) — leaving
  // them around made re-installs look like the profile was bound twice (one
  // to the soft-deleted node, one to the freshly-created replacement). The
  // node row itself stays soft-deleted so audit-trail / lastStatusChange
  // history isn't lost.
  await prisma.profileNodeBinding.deleteMany({ where: { nodeId: id } });
  await repo.softDelete(id);
}
