import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../db/prisma.js';
import { authHeader, createTestUser, deleteTestUsers, startTestApp, type TestUser } from '../../test/integration.js';

type Conversation = { id: string; name: string; unread: boolean; unreadCount: number; lastMessageAt: string; lastMessageId: string; preview: string };
type ListBody = { conversations: Conversation[]; hasMore: boolean };

let app: FastifyInstance;
let me: TestUser;
let peers: TestUser[]; // peers[0] is newest … peers[29] oldest
const MINUTE = 60_000;

beforeAll(async () => {
  app = await startTestApp();
  me = await createTestUser({ displayName: 'Me' });
  peers = await Promise.all(Array.from({ length: 30 }, (_, i) => createTestUser({ displayName: `Peer ${i}` })));
  const now = Date.now();

  // 29 older conversations: one message each, an hour+ apart. Odd-numbered peers
  // wrote last (unread for me); even-numbered ones I wrote last.
  await prisma.message.createMany({
    data: peers.slice(1).map((peer, i) => {
      const idx = i + 1;
      const fromPeer = idx % 2 === 1;
      return {
        senderId: fromPeer ? peer.id : me.id,
        recipientId: fromPeer ? me.id : peer.id,
        content: `last with ${idx}`,
        createdAt: new Date(now - (idx + 1) * 60 * MINUTE),
      };
    }),
  });

  // One very active, recent conversation: 500 messages in the last ~8 hours,
  // all read — the case that used to push every other chat out of the list.
  await prisma.message.createMany({
    data: Array.from({ length: 500 }, (_, i) => ({
      senderId: i % 2 ? peers[0].id : me.id,
      recipientId: i % 2 ? me.id : peers[0].id,
      content: `busy ${i}`,
      createdAt: new Date(now - (500 - i) * MINUTE + 30 * 60 * MINUTE),
      readAt: new Date(),
    })),
  });
});

afterAll(async () => {
  await deleteTestUsers();
  await app.close();
});

const list = async (user: TestUser, query = '') => {
  const res = await app.inject({ method: 'GET', url: `/messaging/conversations${query}`, headers: authHeader(user) });
  return { status: res.statusCode, body: res.json() as ListBody };
};

describe('GET /messaging/conversations', () => {
  it('lists all 30 conversations even when one has 500 recent messages', async () => {
    const { status, body } = await list(me);
    expect(status).toBe(200);
    expect(body.conversations.map((c) => c.id)).toEqual(peers.map((p) => p.id)); // newest first
    expect(body.hasMore).toBe(false);
    expect(body.conversations[0].preview).toBe('busy 499');
  });

  it('flags unread correctly, with counts', async () => {
    const { body } = await list(me);
    for (const [i, conversation] of body.conversations.entries()) {
      const expectUnread = i > 0 && i % 2 === 1;
      expect({ i, unread: conversation.unread, count: conversation.unreadCount }).toEqual({
        i,
        unread: expectUnread,
        count: expectUnread ? 1 : 0,
      });
    }
  });

  it('pages through conversations with no gaps or duplicates', async () => {
    const seen: string[] = [];
    let query = '?limit=7';
    for (let page = 0; page < 10; page++) {
      const { body } = await list(me, query);
      seen.push(...body.conversations.map((c) => c.id));
      if (!body.hasMore) break;
      const last = body.conversations.at(-1)!;
      query = `?limit=7&before=${encodeURIComponent(last.lastMessageAt)}&beforeId=${last.lastMessageId}`;
    }
    expect(seen).toEqual(peers.map((p) => p.id));
  });

  it('excludes peers who are blocked (either way), banned or held', async () => {
    const [blockedByMe, blockedMe, banned, held] = [peers[2], peers[3], peers[4], peers[5]];
    await prisma.block.createMany({
      data: [
        { blockerId: me.id, blockedId: blockedByMe.id },
        { blockerId: blockedMe.id, blockedId: me.id },
      ],
    });
    await prisma.user.update({ where: { id: banned.id }, data: { bannedAt: new Date() } });
    await prisma.user.update({ where: { id: held.id }, data: { heldAt: new Date() } });
    try {
      const ids = (await list(me)).body.conversations.map((c) => c.id);
      expect(ids).toHaveLength(26);
      for (const hidden of [blockedByMe, blockedMe, banned, held]) expect(ids).not.toContain(hidden.id);
    } finally {
      await prisma.block.deleteMany({ where: { OR: [{ blockerId: me.id }, { blockedId: me.id }] } });
      await prisma.user.updateMany({ where: { id: { in: [banned.id, held.id] } }, data: { bannedAt: null, heldAt: null } });
    }
  });

  it.each([['?limit=abc'], ['?limit=0'], ['?before=nope&beforeId=x'], [`?before=${encodeURIComponent(new Date().toISOString())}`]])(
    'rejects %s with 400',
    async (query) => {
      expect((await list(me, query)).status).toBe(400);
    }
  );
});
