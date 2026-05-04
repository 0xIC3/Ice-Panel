import { prisma } from '../../src/prisma.js';

// Listed in the order they need truncating. CASCADE handles FKs but explicit
// listing is documentation. Anything that references another table comes first.
const TABLES = [
  'subscription_events',
  'subscription_request_history',
  'node_user_usage_history',
  'node_usage_history',
  'group_members',
  'group_inbounds',
  'groups',
  'user_traffic',
  'users',
  'inbounds',
  'nodes',
  'api_tokens',
  'admin_users',
];

export async function cleanDatabase(): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
