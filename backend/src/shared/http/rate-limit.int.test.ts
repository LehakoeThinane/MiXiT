import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../db/prisma.js';
import { authHeader, createTestUser, deleteTestUsers, startTestApp } from '../../test/integration.js';

// The integration config sets CLIENT_IP_HEADER=fly-client-ip, as on Fly.io.
// Every inject() comes from 127.0.0.1 — the "proxy" — like production traffic.

let app: FastifyInstance;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(async () => {
  await deleteTestUsers();
  await app.close();
});

const reviewSignIn = (headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: '/auth/review', headers, payload: { email: 'x@int.mixit.test', password: 'wrong' } });

/** Fires `count` requests and returns their status codes. */
async function statuses(count: number, send: () => Promise<{ statusCode: number }>) {
  const codes: number[] = [];
  for (let i = 0; i < count; i++) codes.push((await send()).statusCode);
  return codes;
}

describe('rate limits behind the proxy', () => {
  it('gives each client IP its own bucket (5 review sign-ins per 15 min)', async () => {
    const fromA = await statuses(5, () => reviewSignIn({ 'fly-client-ip': '203.0.113.10' }));
    expect(fromA.every((s) => s !== 429)).toBe(true);
    const limited = await reviewSignIn({ 'fly-client-ip': '203.0.113.10' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ ok: false, message: expect.stringMatching(/Too many requests/) });

    const fromB = await reviewSignIn({ 'fly-client-ip': '203.0.113.11' });
    expect(fromB.statusCode).not.toBe(429);
  });

  it('ignores client-supplied X-Forwarded-For entries (no limit evasion by rotating them)', async () => {
    const codes = await statuses(6, () =>
      reviewSignIn({ 'fly-client-ip': '203.0.113.20', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}` })
    );
    expect(codes[5]).toBe(429);
  });

  it('keys authenticated requests by user, so users behind one IP get separate buckets', async () => {
    const [alice, bob] = await Promise.all([createTestUser(), createTestUser()]);
    const sharedIp = { 'fly-client-ip': '203.0.113.30' };

    const aliceCodes = await statuses(201, () =>
      app.inject({ method: 'GET', url: '/matching/stats', headers: { ...sharedIp, ...authHeader(alice) } })
    );
    expect(aliceCodes.filter((s) => s === 200)).toHaveLength(200);
    expect(aliceCodes[200]).toBe(429);

    const bobRes = await app.inject({ method: 'GET', url: '/matching/stats', headers: { ...sharedIp, ...authHeader(bob) } });
    expect(bobRes.statusCode).toBe(200);
  });

  it("can't exhaust another user's bucket with a forged token", async () => {
    const victim = await createTestUser();
    const forged = jwt.sign({ sub: victim.id, email: victim.email, type: 'access' }, 'not-the-server-secret');
    const attackerIp = { 'fly-client-ip': '203.0.113.40' };

    const forgedCodes = await statuses(201, () =>
      app.inject({ method: 'GET', url: '/matching/stats', headers: { ...attackerIp, authorization: `Bearer ${forged}` } })
    );
    expect(forgedCodes[200]).toBe(429); // the attacker's IP is limited…

    const victimRes = await app.inject({ method: 'GET', url: '/matching/stats', headers: { ...attackerIp, ...authHeader(victim) } });
    expect(victimRes.statusCode).toBe(200); // …but the victim's own bucket is untouched
  });

  it('records the real client IP on new login sessions', async () => {
    const user = await createTestUser();
    const session = await prisma.refreshSession.create({
      data: { userId: user.id, tokenHash: `int-${user.id}`, expiresAt: new Date(Date.now() + 60_000) },
    });
    // Rotate it via /auth/refresh so the route writes the new session's IP.
    const refreshToken = jwt.sign({ sub: user.id, type: 'refresh' }, process.env.JWT_SECRET || 'dev-jwt-secret-do-not-use-in-production');
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { tokenHash: (await import('../auth/jwt.js')).hashToken(refreshToken) },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { 'fly-client-ip': '203.0.113.50' },
      payload: { refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const newest = await prisma.refreshSession.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    expect(newest?.ipAddress).toBe('203.0.113.50');
  });
});
