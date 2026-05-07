import { z } from 'zod';

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[A-Za-z0-9 _-]+$/, 'Letters, digits, space, underscore, hyphen');

export const CreateSquadSchema = z.object({
  name: NameSchema,
  description: z.string().max(1000).nullish(),
  /** Slice 27 — squad ACL is now profile-level. Initial profile assignment;
   *  admin can attach later via PUT. */
  profileIds: z.array(z.uuid()).default([]),
});
export type CreateSquadInput = z.infer<typeof CreateSquadSchema>;

export const UpdateSquadSchema = z.object({
  name: NameSchema.optional(),
  description: z.string().max(1000).nullish(),
  /** When provided, replaces the full profile set (set semantics). */
  profileIds: z.array(z.uuid()).optional(),
});
export type UpdateSquadInput = z.infer<typeof UpdateSquadSchema>;

export const SquadIdParamSchema = z.object({ id: z.uuid() });
