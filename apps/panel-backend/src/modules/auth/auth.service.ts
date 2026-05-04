import type { AdminUser } from '../../generated/prisma/client.js';
import {
  findAdminByUsername,
  verifyPassword,
} from '../admin/admin.service.js';
import type { LoginInput } from './auth.schemas.js';

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid username or password');
    this.name = 'InvalidCredentialsError';
  }
}

/**
 * Verify credentials and return the admin record.
 * The route will sign the JWT — service stays HTTP-agnostic.
 */
export async function login(input: LoginInput): Promise<AdminUser> {
  const admin = await findAdminByUsername(input.username);
  if (!admin) {
    throw new InvalidCredentialsError();
  }

  const ok = await verifyPassword(input.password, admin.passwordHash);
  if (!ok) {
    throw new InvalidCredentialsError();
  }

  return admin;
}