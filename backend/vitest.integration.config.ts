import { defineConfig } from 'vitest/config';

// Integration tests: real Fastify app (fastify.inject) against a real, migrated
// Postgres. Locally, point TEST_DATABASE_URL at a throwaway database — the tests
// create and delete their own `@int.mixit.test` users but never touch anything else.
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) to a migrated Postgres database for integration tests.');
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    // One shared database — run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'test',
      REDIS_URL: '',
      LOG_LEVEL: 'silent',
      CLIENT_IP_HEADER: 'fly-client-ip',
      REVIEW_ACCOUNT_EMAIL: 'review-ttl@int.mixit.test',
      REVIEW_ACCOUNT_PASSWORD: 'integration-review-password',
    },
  },
});
