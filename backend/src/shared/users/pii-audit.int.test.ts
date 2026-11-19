import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { signAccessToken } from '../auth/jwt.js';
import { prisma } from '../db/prisma.js';
import { deleteTestUsers, startTestApp, TEST_EMAIL_DOMAIN } from '../../test/integration.js';

/**
 * Walks every endpoint that returns other users' data and fails if any response
 * contains another user's email address or phone number (brief 1.4).
 * Admin endpoints are excluded by design.
 */

type Person = { id: string; email: string; phone: string; token: string };

let app: FastifyInstance;
let viewer: Person;
let others: Person[];
let roomId: string;

async function makePerson(i: number, profile: boolean): Promise<Person> {
  const email = `pii-${i}-${crypto.randomUUID()}${TEST_EMAIL_DOMAIN}`;
  const phone = `+2771${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  const user = await prisma.user.create({
    data: {
      email,
      phone,
      termsAcceptedAt: new Date(),
      isHost: true,
      ...(profile
        ? {
            profile: {
              create: {
                displayName: `Person ${i}`,
                age: 25,
                gender: 'other',
                city: 'Soweto',
                interests: ['music'],
                completedAt: new Date(),
                lastActive: new Date(),
              },
            },
          }
        : {}),
    },
  });
  return { id: user.id, email, phone, token: signAccessToken(user.id, email) };
}

beforeAll(async () => {
  app = await startTestApp();
  viewer = await makePerson(0, true);
  // others[0] has NO profile — the case that used to fall back to the email.
  others = await Promise.all([makePerson(1, false), makePerson(2, true), makePerson(3, true), makePerson(4, true)]);
  const [noProfile, chatty, blocked, vibing] = others;

  await prisma.message.createMany({
    data: [
      { senderId: noProfile.id, recipientId: viewer.id, content: 'hi from no-profile' },
      { senderId: chatty.id, recipientId: viewer.id, content: 'hello' },
      { senderId: viewer.id, recipientId: chatty.id, content: 'hey' },
    ],
  });
  await prisma.block.create({ data: { blockerId: viewer.id, blockedId: blocked.id } });
  await prisma.vibe.create({ data: { fromUserId: vibing.id, toUserId: viewer.id } });

  const room = await prisma.room.create({ data: { slug: `pii-${crypto.randomUUID()}`, name: 'PII audit room' } });
  roomId = room.id;
  await prisma.roomMembership.createMany({ data: [viewer, chatty, vibing].map((p) => ({ roomId, userId: p.id })) });
  await prisma.roomMessage.create({ data: { roomId, userId: chatty.id, content: 'room hello' } });
  await prisma.roomEvent.create({
    data: { roomId, hostId: vibing.id, title: 'Audit meetup', startsAt: new Date(Date.now() + 3_600_000) },
  });
});

afterAll(async () => {
  await prisma.room.deleteMany({ where: { id: roomId } });
  await deleteTestUsers();
  await app.close();
});

describe("responses never contain another user's email or phone", () => {
  const endpoints = () => [
    '/messaging/conversations',
    ...others.map((o) => `/messaging/thread/${o.id}`),
    ...others.map((o) => `/profiles/${o.id}`),
    '/matching/candidates',
    '/matching/vibes',
    '/matching/stats',
    '/rooms/list',
    `/rooms/${roomId}/messages`,
    `/events/room/${roomId}`,
    '/events/upcoming',
    '/moderation/blocked',
    '/referrals/me',
  ];

  it('across every user-facing GET endpoint', async () => {
    const leaks: string[] = [];
    const checked: string[] = [];
    for (const url of endpoints()) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${viewer.token}` } });
      expect(res.statusCode, `${url} → ${res.statusCode}`).toBeLessThan(500);
      checked.push(`${url} ${res.statusCode}`);
      for (const other of others) {
        if (res.body.includes(other.email)) leaks.push(`${url} leaks email of ${other.id}`);
        if (res.body.includes(other.phone)) leaks.push(`${url} leaks phone of ${other.id}`);
      }
    }
    expect(leaks, `checked:\n${checked.join('\n')}`).toEqual([]);
  });

  it('shows a neutral name for users without a profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/messaging/conversations',
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    const conversation = (res.json() as { conversations: { id: string; name: string; initial: string }[] }).conversations.find(
      (c) => c.id === others[0].id
    );
    expect(conversation).toMatchObject({ name: 'MiXiT user', initial: 'M' });
  });

  it('returns the chat peer’s public identity with the thread', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/messaging/thread/${others[1].id}`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    expect((res.json() as { peer: unknown }).peer).toEqual({
      id: others[1].id,
      displayName: 'Person 2',
      initial: 'P',
      online: true,
    });
  });

  it('hides online status and last-seen when the user turns "show last seen" off', async () => {
    await prisma.profile.update({ where: { userId: others[1].id }, data: { showLastSeen: false } });
    const headers = { authorization: `Bearer ${viewer.token}` };
    const profile = (await app.inject({ method: 'GET', url: `/profiles/${others[1].id}`, headers })).json() as {
      profile: { lastActive: string | null; online: boolean };
    };
    const thread = (await app.inject({ method: 'GET', url: `/messaging/thread/${others[1].id}`, headers })).json() as {
      peer: { online: boolean };
    };
    expect(profile.profile.lastActive).toBeNull();
    expect(profile.profile.online).toBe(false);
    expect(thread.peer.online).toBe(false);
  });
});
