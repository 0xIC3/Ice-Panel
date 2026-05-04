import { defineConfig } from 'vitest/config';
import { config as dotenvConfig } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFromFile = dotenvConfig({
  path: resolve(__dirname, '../../.env.test'),
}).parsed ?? {};

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    env: envFromFile,
    // Integration tests share a single test Postgres — serialize across files
    // to avoid collisions on cleanDatabase() / unique constraints.
    fileParallelism: false,
  },
});
