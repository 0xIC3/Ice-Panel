import { prisma } from '../../prisma.js';
import { generateUserCredentials } from '../../lib/credentials.js';
import type {
  CreateUserInput,
  UpdateUserInput,
  ListUsersQuery,
} from './users.schemas.js';
import { mapUserToPublic, type PublicUserDto } from './users.mapper.js';

// ───── Domain errors ─────

export class UserAlreadyExistsError extends Error {
  constructor(public username: string) {
    super(`User "${username}" already exists`);
    this.name = 'UserAlreadyExistsError';
  }
}

export class UserNotFoundError extends Error {
  constructor(public id: string) {
    super(`User ${id} not found`);
    this.name = 'UserNotFoundError';
  }
}

// ───── Helpers ─────

const BYTES_PER_GB = 1_073_741_824n; // 1024 * 1024 * 1024

function gbToBytes(gb: number | null | undefined): bigint | null {
  return gb != null ? BigInt(gb) * BYTES_PER_GB : null;
}

function daysFromNow(days: number | null | undefined): Date | null {
  if (days == null) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function toBigIntOrNull(value: number | string | null | undefined): bigint | null {
  if (value == null) return null;
  return BigInt(value);
}

// ───── Service methods ─────

export async function createUser(input: CreateUserInput): Promise<PublicUserDto> {
  // Username uniqueness check (we don't enforce at DB level due to soft-delete)
  const existing = await prisma.user.findFirst({
    where: { username: input.username, deletedAt: null },
  });
  if (existing) {
    throw new UserAlreadyExistsError(input.username);
  }

  const creds = generateUserCredentials();

  const user = await prisma.user.create({
    data: {
      username: input.username,
      shortId: creds.shortId,
      subscriptionToken: creds.subscriptionToken,

      hysteriaPassword:    creds.hysteriaPassword,
      naivePassword:       creds.naivePassword,
      xrayUuid:            creds.xrayUuid,
      amneziawgPrivateKey: creds.amneziawgPrivateKey,
      amneziawgPublicKey:  creds.amneziawgPublicKey,

      trafficLimitBytes:    gbToBytes(input.trafficLimitGb),
      trafficLimitStrategy: input.trafficLimitStrategy,
      expireAt:             daysFromNow(input.expireDays),

      hwidDeviceLimit: input.hwidDeviceLimit ?? null,
      description:     input.description ?? null,
      tag:             input.tag ?? null,
      telegramId:      toBigIntOrNull(input.telegramId),
      email:           input.email ?? null,

      // Nested create: same transaction as User insert
      traffic: { create: {} },

      // Group memberships
      groupMembers: {
        create: input.groupIds.map((groupId) => ({ groupId })),
      },
    },
    include: { traffic: true },
  });

  return mapUserToPublic(user, user.traffic);
}

export async function listUsers(query: ListUsersQuery): Promise<{
  users: PublicUserDto[];
  total: number;
  page: number;
  limit: number;
}> {
  const where = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.groupId
      ? { groupMembers: { some: { groupId: query.groupId } } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { username: { contains: query.search, mode: 'insensitive' as const } },
            { email:    { contains: query.search, mode: 'insensitive' as const } },
            { tag:      { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: { traffic: true },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map((u) => mapUserToPublic(u, u.traffic)),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getUserById(id: string): Promise<PublicUserDto> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: { traffic: true },
  });
  if (!user) {
    throw new UserNotFoundError(id);
  }
  return mapUserToPublic(user, user.traffic);
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<PublicUserDto> {
  const existing = await prisma.user.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) {
    throw new UserNotFoundError(id);
  }

  const data: Record<string, unknown> = {};

  if (input.status !== undefined)               data.status = input.status;
  if (input.trafficLimitGb !== undefined)       data.trafficLimitBytes = gbToBytes(input.trafficLimitGb);
  if (input.trafficLimitStrategy !== undefined) data.trafficLimitStrategy = input.trafficLimitStrategy;
  if (input.expireAt !== undefined)             data.expireAt = input.expireAt ? new Date(input.expireAt) : null;
  if (input.hwidDeviceLimit !== undefined)      data.hwidDeviceLimit = input.hwidDeviceLimit;
  if (input.description !== undefined)          data.description = input.description;
  if (input.tag !== undefined)                  data.tag = input.tag;
  if (input.telegramId !== undefined)           data.telegramId = toBigIntOrNull(input.telegramId);
  if (input.email !== undefined)                data.email = input.email;

  if (input.groupIds !== undefined) {
    // Replace all memberships in one go
    data.groupMembers = {
      deleteMany: {},
      create: input.groupIds.map((groupId) => ({ groupId })),
    };
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    include: { traffic: true },
  });

  return mapUserToPublic(updated, updated.traffic);
}

export async function deleteUser(id: string): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) {
    throw new UserNotFoundError(id);
  }

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}