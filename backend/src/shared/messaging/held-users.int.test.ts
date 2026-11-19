import type { FastifyInstance } from 'fastify';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../db/prisma.js';
import {
  authHeader,
  createTestUser,
  deleteTestUsers,
  eventually,
  startListeningApp,
  type TestUser,
} from '../../test/integration.js';

// Brief 1.7 + owner decision §11 Q6: held (under-review) users can't send DMs,
// and DMs to them are rejected like DMs to a banned user.

let app: FastifyInstance;
let url: string;
let alice: TestUser;
let bob: TestUser;
const sockets: Socket[] = [];

const hold = (user: TestUser) => prisma.user.update({ where: { id: user.id }, data: { heldAt: new Date() } });
const release = (user: TestUser) => prisma.user.update({ where: { id: user.id }, data: { heldAt: null } });
const countMessages = (from: TestUser, to: TestUser) =>
  prisma.message.count({ where: { senderId: from.id, recipientId: to.id } });

const sendRest = (from: TestUser, to: TestUser, content = 'hi') =>
  app.inject({ method: 'POST', url: '/messaging/messages', headers: authHeader(from), payload: { recipientId: to.id, content } });

async function sendSocket(from: TestUser, to: TestUser): Promise<{ delivered: boolean; error?: string }> {
  const socket = connect(url, { auth: { token: from.token }, transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', reject);
  });
  const outcome: { delivered: boolean; error?: string }[] = [];
  socket.on('message:delivered', () => outcome.push({ delivered: true }));
  socket.on('message:error', ({ message }: { message: string }) => outcome.push({ delivered: false, error: message }));
  socket.emit('message:send', { recipientId: to.id, content: 'hi over socket' });
  await eventually(() => expect(outcome).toHaveLength(1));
  return outcome[0];
}

beforeAll(async () => {
  ({ app, url } = await startListeningApp());
});
afterAll(async () => {
  await deleteTestUsers();
  await app.close();
});
beforeEach(async () => {
  alice = await createTestUser({ displayName: 'Alice' });
  bob = await createTestUser({ displayName: 'Bob' });
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await deleteTestUsers();
});

describe('a held user', () => {
  it('cannot send DMs over REST', async () => {
    await hold(alice);
    const res = await sendRest(alice, bob);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { message: string }).message).toMatch(/under review/);
    expect(await countMessages(alice, bob)).toBe(0);
  });

  it('cannot send DMs over the socket', async () => {
    await hold(alice);
    const outcome = await sendSocket(alice, bob);
    expect(outcome).toEqual({ delivered: false, error: expect.stringMatching(/under review/) });
    expect(await countMessages(alice, bob)).toBe(0);
  });

  it('cannot receive DMs — the sender sees "Recipient not found" (REST and socket)', async () => {
    await hold(bob);
    const rest = await sendRest(alice, bob);
    expect(rest.statusCode).toBe(404);
    expect((rest.json() as { message: string }).message).toBe('Recipient not found');

    const socket = await sendSocket(alice, bob);
    expect(socket).toEqual({ delivered: false, error: 'Recipient not found' });
    expect(await countMessages(alice, bob)).toBe(0);
  });

  it('is hidden from chat lists and chat headers while held', async () => {
    await sendRest(bob, alice, 'earlier message');
    await hold(bob);

    const list = await app.inject({ method: 'GET', url: '/messaging/conversations', headers: authHeader(alice) });
    expect((list.json() as { conversations: { id: string }[] }).conversations.map((c) => c.id)).not.toContain(bob.id);

    const thread = await app.inject({ method: 'GET', url: `/messaging/thread/${bob.id}`, headers: authHeader(alice) });
    expect((thread.json() as { peer: { displayName: string } }).peer.displayName).toBe('MiXiT user');
  });

  it('can message again once a moderator releases the hold', async () => {
    await hold(alice);
    expect((await sendRest(alice, bob)).statusCode).toBe(403);
    await release(alice);
    expect((await sendRest(alice, bob)).statusCode).toBe(200);
  });
});

describe('end to end: an "underage" report', () => {
  it('auto-holds the reported user, who then cannot DM anyone', async () => {
    const report = await app.inject({
      method: 'POST',
      url: '/moderation/report',
      headers: authHeader(bob),
      payload: { userId: alice.id, reason: 'underage' },
    });
    expect(report.statusCode).toBe(200);

    const carol = await createTestUser({ displayName: 'Carol' });
    expect((await sendRest(alice, carol)).statusCode).toBe(403);
    expect((await sendSocket(alice, carol)).delivered).toBe(false);
    expect(await countMessages(alice, carol)).toBe(0);
  });
});
