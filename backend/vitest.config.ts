import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests need a real Postgres — run them with `pnpm run test:integration`.
    exclude: ['src/**/*.int.test.ts', 'node_modules/**'],
    env: {
      // env.ts validates these are present/well-formed at import time —
      // tests never open a real connection, this just satisfies validation.
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      NODE_ENV: 'test',
    },
  },
});
