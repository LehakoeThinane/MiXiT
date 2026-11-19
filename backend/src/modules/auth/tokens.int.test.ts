import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../shared/db/prisma.js';
import { deleteTestUsers, startTestApp } from '../../test/integration.js';

// The integration config sets REVIEW_ACCOUNT_* and leaves JWT_*_TTL unset,
// so these tests check the defaults: 15-minute access, 30-day refresh.
const REVIEW = { email: 'review-ttl@int.mixit.test', password: 'integration-review-password' };

let app: FastifyInstance;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(async () => {
  await deleteTestUsers();
  await app.close();
});

type AuthBody = { tokens: { accessToken: string; refreshToken: string; expiresIn: string } };
const lifetime = (token: string) => {
  const payload = jwt.decode(token) as { iat: number; exp: number };
  return payload.exp - payload.iat;
};

describe('issuing tokens', () => {
  it('lets the same user sign in twice within one second (double-tap, two devices)', async () => {
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/auth/review', payload: REVIEW }),
      app.inject({ method: 'POST', url: '/auth/review', payload: REVIEW }),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const a = (first.json() as AuthBody).tokens;
    const b = (second.json() as AuthBody).tokens;
    expect(a.refreshToken).not.toBe(b.refreshToken);
    expect(a.accessToken).not.toBe(b.accessToken);
  });
});

describe('token lifetimes', () => {
  it('issues 15-minute access tokens and 30-day refresh sessions by default, and says so', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/review', payload: REVIEW });
    expect(res.statusCode).toBe(200);
    const { tokens } = res.json() as AuthBody;

    expect(lifetime(tokens.accessToken)).toBe(15 * 60);
    expect(tokens.expiresIn).toBe('900');
    expect(lifetime(tokens.refreshToken)).toBe(30 * 86_400);

    const session = await prisma.refreshSession.findFirst({
      where: { user: { email: REVIEW.email } },
      orderBy: { createdAt: 'desc' },
    });
    const sessionDays = (session!.expiresAt.getTime() - session!.createdAt.getTime()) / 86_400_000;
    expect(sessionDays).toBeCloseTo(30, 1);
  });

  it('applies the same lifetimes when refreshing', async () => {
    const signIn = (await app.inject({ method: 'POST', url: '/auth/review', payload: REVIEW })).json() as AuthBody;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: signIn.tokens.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const { tokens } = res.json() as AuthBody;
    expect(lifetime(tokens.accessToken)).toBe(15 * 60);
    expect(tokens.expiresIn).toBe('900');
  });
});
