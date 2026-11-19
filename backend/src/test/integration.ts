/**
 * Helpers for integration tests (`*.int.test.ts`, run with `pnpm run test:integration`).
 * Builds the real app and creates throwaway users in the real database.
 */
import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app.js';
import { signAccessToken } from '../shared/auth/jwt.js';
import { prisma } from '../shared/db/prisma.js';

export const TEST_EMAIL_DOMAIN = '@int.mixit.test';

export type TestUser = { id: string; email: string; token: string };

export async function startTestApp(): Promise<FastifyInstance> {
  const app = buildApp();
  await app.ready();
  return app;
}

/** Real HTTP server on a random port — for Socket.IO clients. */
export async function startListeningApp(): Promise<{ app: FastifyInstance; url: string }> {
  const app = buildApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  return { app, url: `http://127.0.0.1:${address.port}` };
}

/** Polls until `check` passes or the timeout expires (then runs it once more to surface the failure). */
export async function eventually(check: () => void, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export async function createTestUser(profile: { displayName?: string; city?: string } = {}): Promise<TestUser> {
  const email = `${crypto.randomUUID()}${TEST_EMAIL_DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      email,
      termsAcceptedAt: new Date(),
      profile: {
        create: {
          displayName: profile.displayName ?? 'Test user',
          age: 25,
          gender: 'other',
          city: profile.city ?? 'Soweto',
          interests: ['music'],
          completedAt: new Date(),
        },
      },
    },
  });
  return { id: user.id, email, token: signAccessToken(user.id, email) };
}

export function authHeader(user: TestUser) {
  return { authorization: `Bearer ${user.token}` };
}

/** Deletes every user created by these helpers (their data cascades). */
export async function deleteTestUsers(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}
