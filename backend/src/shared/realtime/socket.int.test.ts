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

let app: FastifyInstance;
let url: string;
let alice: TestUser;
let bob: TestUser;
const sockets: Socket[] = [];

/** Connects and resolves on 'connect'. Listeners attached by the test record events. */
function openSocket(user: TestUser): Promise<Socket> {
  const socket = connect(url, { auth: { token: user.token }, transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function record(socket: Socket, event: string) {
  const seen: unknown[] = [];
  socket.on(event, (payload: unknown) => seen.push(payload));
  return seen;
}

const storedFromAlice = () => prisma.message.count({ where: { senderId: alice.id, recipientId: bob.id } });

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

describe('socket message:send', () => {
  it('handles a message sent the instant the socket connects', async () => {
    const socket = connect(url, { auth: { token: alice.token }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    const delivered = record(socket, 'message:delivered');
    socket.on('connect', () => socket.emit('message:send', { recipientId: bob.id, content: 'first!' }));

    await eventually(() => expect(delivered).toHaveLength(1));
  });

  it('rejects sends beyond 60 per minute with message:error', async () => {
    const socket = await openSocket(alice);
    const delivered = record(socket, 'message:delivered');
    const errors = record(socket, 'message:error') as { message: string }[];

    for (let i = 1; i <= 70; i++) socket.emit('message:send', { recipientId: bob.id, content: `m${i}` });

    await eventually(() => expect(delivered.length + errors.length).toBe(70), 10_000);
    expect(delivered).toHaveLength(60);
    expect(errors).toHaveLength(10);
    expect(errors[0].message).toMatch(/too quickly/);
    expect(await storedFromAlice()).toBe(60);
  });

  it('shares one budget between REST and socket sends', async () => {
    const restStatuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/messaging/messages',
        headers: authHeader(alice),
        payload: { recipientId: bob.id, content: `rest ${i}` },
      });
      restStatuses.push(res.statusCode);
    }
    expect(restStatuses.every((s) => s === 200)).toBe(true);

    const socket = await openSocket(alice);
    const delivered = record(socket, 'message:delivered');
    const errors = record(socket, 'message:error');
    for (let i = 0; i < 30; i++) socket.emit('message:send', { recipientId: bob.id, content: `socket ${i}` });
    await eventually(() => expect(delivered.length + errors.length).toBe(30), 10_000);
    expect(delivered).toHaveLength(20);

    const extra = await app.inject({
      method: 'POST',
      url: '/messaging/messages',
      headers: authHeader(alice),
      payload: { recipientId: bob.id, content: 'one too many' },
    });
    expect(extra.statusCode).toBe(429);
    expect(await storedFromAlice()).toBe(60);
  });

  it('ignores malformed payloads and keeps working', async () => {
    const socket = await openSocket(alice);
    const delivered = record(socket, 'message:delivered');
    for (const payload of [null, 'text', 42, [bob.id], { recipientId: 7 }, { recipientId: bob.id, content: { a: 1 } }, { recipientId: bob.id, content: 'x', type: 'exe' }]) {
      socket.emit('message:send', payload);
    }
    socket.emit('room:join', null);
    socket.emit('typing:start', 'nope');
    socket.emit('message:send', { recipientId: bob.id, content: 'valid' });

    await eventually(() => expect(delivered).toHaveLength(1));
    expect(await storedFromAlice()).toBe(1);
  });
});

describe('socket typing events', () => {
  it('relays typing between users who have not blocked each other', async () => {
    const [aliceSocket, bobSocket] = await Promise.all([openSocket(alice), openSocket(bob)]);
    const typing = record(bobSocket, 'typing:start') as { senderId: string }[];
    aliceSocket.emit('typing:start', { recipientId: bob.id });
    await eventually(() => expect(typing).toEqual([{ senderId: alice.id }]));
  });

  it('drops typing from a user the recipient has blocked, and resumes after unblock', async () => {
    const block = await app.inject({ method: 'POST', url: '/moderation/block', headers: authHeader(bob), payload: { userId: alice.id } });
    expect(block.statusCode).toBe(200);

    // Carol is a control: her receiving Alice's typing proves the handler is live,
    // so Bob receiving nothing is the block working, not a dropped event.
    const carol = await createTestUser({ displayName: 'Carol' });
    const [aliceSocket, bobSocket, carolSocket] = await Promise.all([openSocket(alice), openSocket(bob), openSocket(carol)]);
    const typing = record(bobSocket, 'typing:start');
    const carolTyping = record(carolSocket, 'typing:start');
    aliceSocket.emit('typing:start', { recipientId: bob.id });
    aliceSocket.emit('typing:start', { recipientId: carol.id });
    await eventually(() => expect(carolTyping).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(typing).toHaveLength(0);

    await app.inject({ method: 'DELETE', url: `/moderation/block/${alice.id}`, headers: authHeader(bob) });
    aliceSocket.emit('typing:start', { recipientId: bob.id });
    await eventually(() => expect(typing).toHaveLength(1));
  });

  it('throttles typing floods', async () => {
    const [aliceSocket, bobSocket] = await Promise.all([openSocket(alice), openSocket(bob)]);
    const typing = record(bobSocket, 'typing:start');
    for (let i = 0; i < 100; i++) aliceSocket.emit('typing:start', { recipientId: bob.id });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(typing.length).toBeGreaterThan(0);
    expect(typing.length).toBeLessThanOrEqual(30);
  });
});
