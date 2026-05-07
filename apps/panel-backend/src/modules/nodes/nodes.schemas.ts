import { z } from 'zod';

const NameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(64, 'Name too long')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Name may contain letters, digits, dot, underscore, hyphen');

const AddressSchema = z
  .string()
  .min(3, 'Address is required')
  .max(255, 'Address too long')
  // host[:port] — host is IPv4 or DNS, port optional integer
  .regex(
    /^[a-zA-Z0-9.-]+(:\d{1,5})?$/,
    'Address must be host or host:port (IPv4 or DNS, no scheme)',
  );

const CountryCodeSchema = z.string().length(2).regex(/^[A-Z]{2}$/);

const ProtocolSchema = z.enum(['xray', 'hysteria', 'amneziawg', 'naive']);

export const CreateNodeSchema = z.object({
  name: NameSchema,
  address: AddressSchema,
  protocol: ProtocolSchema.default('xray'),
  countryCode: CountryCodeSchema.nullish(),
  consumptionMultiplier: z.number().int().positive().default(1),
});
export type CreateNodeInput = z.infer<typeof CreateNodeSchema>;

export const UpdateNodeSchema = z.object({
  name: NameSchema.optional(),
  address: AddressSchema.optional(),
  protocol: ProtocolSchema.optional(),
  countryCode: CountryCodeSchema.nullish(),
  consumptionMultiplier: z.number().int().positive().optional(),
});
export type UpdateNodeInput = z.infer<typeof UpdateNodeSchema>;

export const ListNodesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z.string().max(16).optional(),
});
export type ListNodesQuery = z.infer<typeof ListNodesQuerySchema>;

export const NodeIdParamSchema = z.object({
  id: z.uuid(),
});
export type NodeIdParam = z.infer<typeof NodeIdParamSchema>;
