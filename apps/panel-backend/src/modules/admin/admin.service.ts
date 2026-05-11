import bcrypt from 'bcrypt';
import { prisma } from '../../prisma.js';
import type { CreateAdminInput } from './admin.schemas.js';
import { mapAdminToPublic, type PublicAdminDto } from './admin.mapper.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/telegram-notify.js';

const BCRYPT_COST = 12;

export class AdminAlreadyExistsError extends Error {
  constructor(public username: string) {
    super(`Admin "${username}" already exists`);
    this.name = 'AdminAlreadyExistsError';
  }
}

export class AdminNotFoundError extends Error {
  constructor() {
    super('Admin not found');
    this.name = 'AdminNotFoundError';
  }
}

export async function countAdmins(): Promise<number> {
  return prisma.adminUser.count({ where: { deletedAt: null } });
}

export async function createAdmin(input: CreateAdminInput): Promise<PublicAdminDto> {
  const existing = await prisma.adminUser.findFirst({
    where: { username: input.username, deletedAt: null },
  });
  if (existing) {
    throw new AdminAlreadyExistsError(input.username);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);

  const admin = await prisma.adminUser.create({
    data: {
      username: input.username,
      passwordHash,
      role: 'admin',
    },
  });

  notifyTelegramAsync(
    `👤 *Admin created*\nusername: \`${escapeMarkdown(admin.username)}\`\nrole: \`${admin.role}\``,
  );

  return mapAdminToPublic(admin);
}

export async function findAdminByUsername(username: string) {
  return prisma.adminUser.findFirst({
    where: { username, deletedAt: null },
  });
}

export async function findAdminById(id: string) {
  return prisma.adminUser.findFirst({
    where: { id, deletedAt: null },
  });
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
