import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      // env.ts validates these are present/well-formed at import time —
      // tests never open a real connection, this just satisfies validation.
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      NODE_ENV: 'test',
    },
  },
});
