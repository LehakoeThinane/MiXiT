import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../shared/db/prisma.js';
import {
  authHeader,
  createTestUser,
  deleteTestUsers,
  startTestApp,
  type TestUser,
} from '../../test/integration.js';

type ThreadBody = { ok: boolean; messages: { id: string; content: string; createdAt: string }[]; hasMore: boolean };

let app: FastifyInstance;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(async () => {
  await deleteTestUsers();
  await app.close();
});
beforeEach(async () => {
  await deleteTestUsers();
  alice = await createTestUser({ displayName: 'Alice' });
  bob = await createTestUser({ displayName: 'Bob' });
});

/** Alice → Bob messages "#1"…"#count", one second apart (or all at one instant). */
async function seedThread(count: number, opts: { sameTimestamp?: boolean } = {}) {
  const start = Date.now() - count * 1000;
  await prisma.message.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      senderId: alice.id,
      recipientId: bob.id,
      content: `#${i + 1}`,
      createdAt: new Date(opts.sameTimestamp ? start : start + i * 1000),
    })),
  });
}

async function getPage(viewer: TestUser, peer: TestUser, query = '') {
  const res = await app.inject({
    method: 'GET',
    url: `/messaging/thread/${peer.id}${query}`,
    headers: authHeader(viewer),
  });
  return { status: res.statusCode, body: res.json() as ThreadBody };
}

/** Walks every page from newest to oldest; returns contents in chronological order. */
async function walkAllPages(viewer: TestUser, peer: TestUser, limit: number) {
  const seen: string[] = [];
  let query = `?limit=${limit}`;
  for (let pages = 0; pages < 100; pages++) {
    const { body } = await getPage(viewer, peer, query);
    seen.unshift(...body.messages.map((m) => m.content));
    if (!body.hasMore) return seen;
    const oldest = body.messages[0];
    query = `?limit=${limit}&before=${encodeURIComponent(oldest.createdAt)}&beforeId=${oldest.id}`;
  }
  throw new Error('pagination did not terminate');
}

describe('GET /messaging/thread/:peerUserId', () => {
  it('opens on the newest messages, oldest-first within the page', async () => {
    await seedThread(120);
    const { status, body } = await getPage(bob, alice);

    expect(status).toBe(200);
    expect(body.messages).toHaveLength(50);
    expect(body.messages[0].content).toBe('#71');
    expect(body.messages.at(-1)?.content).toBe('#120');
    expect(body.hasMore).toBe(true);
  });

  it('pages back through the whole thread with no gaps or duplicates', async () => {
    await seedThread(120);
    const all = await walkAllPages(bob, alice, 50);
    expect(all).toEqual(Array.from({ length: 120 }, (_, i) => `#${i + 1}`));
  });

  it('is deterministic when many messages share a timestamp', async () => {
    await seedThread(10, { sameTimestamp: true });
    const all = await walkAllPages(bob, alice, 3);
    expect(all).toHaveLength(10);
    expect(new Set(all).size).toBe(10);
  });

  it('only marks the returned page as read', async () => {
    await seedThread(60);
    await getPage(bob, alice);

    const unread = await prisma.message.findMany({
      where: { senderId: alice.id, recipientId: bob.id, readAt: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(unread.map((m) => m.content)).toEqual(Array.from({ length: 10 }, (_, i) => `#${i + 1}`));
  });

  it.each([
    ['limit=abc', '?limit=abc'],
    ['limit out of range', '?limit=500'],
    ['malformed before', `?before=garbage&beforeId=x`],
    ['before without beforeId', `?before=${encodeURIComponent(new Date().toISOString())}`],
  ])('rejects %s with 400 instead of a 500', async (_label, query) => {
    const { status } = await getPage(bob, alice, query);
    expect(status).toBe(400);
  });
});

describe('GET /rooms/:roomId/messages', () => {
  it('pages deterministically through same-timestamp messages', async () => {
    const room = await prisma.room.create({ data: { slug: `int-${Date.now()}`, name: 'Int test room' } });
    try {
      const at = new Date();
      await prisma.roomMessage.createMany({
        data: Array.from({ length: 7 }, (_, i) => ({ roomId: room.id, userId: alice.id, content: `r${i}`, createdAt: at })),
      });

      const seen: string[] = [];
      let query = '?limit=3';
      for (let i = 0; i < 10; i++) {
        const res = await app.inject({ method: 'GET', url: `/rooms/${room.id}/messages${query}`, headers: authHeader(bob) });
        const messages = (res.json() as { messages: { id: string; content: string; createdAt: string }[] }).messages;
        if (messages.length === 0) break;
        seen.unshift(...messages.map((m) => m.content));
        query = `?limit=3&before=${encodeURIComponent(messages[0].createdAt)}&beforeId=${messages[0].id}`;
      }
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    } finally {
      await prisma.room.delete({ where: { id: room.id } });
    }
  });

  it('rejects a non-numeric limit with 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/rooms/any/messages?limit=abc', headers: authHeader(bob) });
    expect(res.statusCode).toBe(400);
  });
});
