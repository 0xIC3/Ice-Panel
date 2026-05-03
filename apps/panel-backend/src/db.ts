import postgres from 'postgres';
import { config } from './config.js';

export const sql = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export async function pingDatabase(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch (err) {
    return false;
  }
}
