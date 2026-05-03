import { z } from 'zod';

// ───── Reusable atoms ─────

export const TrafficLimitStrategy = z.enum(['no_reset', 'day', 'week', 'month']);

export const UserStatus = z.enum(['active', 'disabled', 'expired', 'limited']);

const UsernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(64, 'Username too long')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Username can contain only letters, digits, underscore, and hyphen');

// ───── POST /api/users ─────

export const CreateUserSchema = z.object({
  username: UsernameSchema,
  trafficLimitGb: z.number().int().positive().nullish(),         // null/undefined = unlimited
  trafficLimitStrategy: TrafficLimitStrategy.default('no_reset'),
  expireDays: z.number().int().positive().nullish(),             // null/undefined = no expiry
  hwidDeviceLimit: z.number().int().positive().nullish(),
  description: z.string().max(1000).nullish(),
  tag: z.string().max(64).nullish(),
  telegramId: z.union([
    z.number().int(),
    z.string().regex(/^\d+$/),
  ]).nullish(),
  email: z.email().max(255).nullish(),
  groupIds: z.array(z.uuid()).default([]),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// ───── PUT /api/users/:id ─────

export const UpdateUserSchema = z.object({
  status: z.enum(['active', 'disabled']).optional(),             // expired/limited только cron'ом
  trafficLimitGb: z.number().int().positive().nullish(),
  trafficLimitStrategy: TrafficLimitStrategy.optional(),
  expireAt: z.iso.datetime().nullish(),                          // ISO 8601 string OR null
  hwidDeviceLimit: z.number().int().positive().nullish(),
  description: z.string().max(1000).nullish(),
  tag: z.string().max(64).nullish(),
  telegramId: z.union([
    z.number().int(),
    z.string().regex(/^\d+$/),
  ]).nullish(),
  email: z.email().max(255).nullish(),
  groupIds: z.array(z.uuid()).optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// ───── GET /api/users (query params) ─────

export const ListUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: UserStatus.optional(),
  search: z.string().min(1).max(64).optional(),                  // matches username/email/telegramId/tag
  groupId: z.uuid().optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

// ───── Path params for /api/users/:id ─────

export const UserIdParamSchema = z.object({
  id: z.uuid(),
});
export type UserIdParam = z.infer<typeof UserIdParamSchema>;
