import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

import { extractBearerToken, verifyAccessToken } from '../auth/jwt.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { isUserBanned } from '../moderation/actions.js';
import { sendDirectMessage, type SendDirectMessageInput } from '../messaging/direct-messages.js';
import { isBlockedPairCached } from '../moderation/blocks.js';
import { BUDGETS, consumeUserBudget } from '../rate-limit/user-budget.js';
import { logger } from '../utils/logger.js';

let io: Server | null = null;
let adapterPub: Redis | null = null;
let adapterSub: Redis | null = null;

// ---------------------------------------------------------------------------
// Payload guards — socket events are untrusted input with no schema validation
// from Fastify, so anything that doesn't match is ignored.
// ---------------------------------------------------------------------------

const MESSAGE_TYPES = new Set(['text', 'voice', 'image']);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isBoundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export function parseId(payload: unknown, field: string): string | null {
  if (!isRecord(payload)) return null;
  const value = payload[field];
  return isBoundedString(value, 36) ? value : null;
}

export function parseMessageSend(payload: unknown): SendDirectMessageInput | null {
  if (!isRecord(payload)) return null;
  const { recipientId, content, type, mediaUrl } = payload;
  if (!isBoundedString(recipientId, 36)) return null;
  if (content !== undefined && content !== null && (typeof content !== 'string' || content.length > 4000)) return null;
  if (type !== undefined && (typeof type !== 'string' || !MESSAGE_TYPES.has(type))) return null;
  if (mediaUrl !== undefined && mediaUrl !== null && !isBoundedString(mediaUrl, 2000)) return null;
  return {
    recipientId,
    content: (content as string | null | undefined) ?? undefined,
    type: type as string | undefined,
    mediaUrl: (mediaUrl as string | null | undefined) ?? undefined,
  };
}

function resolveTokenFromHandshake(authHeader: string | string[] | undefined, authToken?: unknown) {
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
  return extractBearerToken(authHeader);
}

export async function initSocketServer(app: FastifyInstance) {
  if (io) return io;

  io = new Server(app.server, {
    cors: { origin: true },
    transports: ['websocket', 'polling'],
    pingTimeout: 60_000,
    pingInterval: 25_000,
  });

  if (env.redisUrl) {
    try {
      const clientOpts = { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5_000, commandTimeout: 3_000 };
      adapterPub = new Redis(env.redisUrl, clientOpts);
      adapterSub = new Redis(env.redisUrl, clientOpts);
      adapterPub.on('error', () => {}); // suppress unhandled error events
      adapterSub.on('error', () => {});
      await Promise.all([adapterPub.connect(), adapterSub.connect()]);
      io.adapter(createAdapter(adapterPub, adapterSub));
      logger.info('Socket.IO Redis adapter active — multi-instance messaging enabled');
    } catch (error) {
      logger.warn('Socket.IO Redis adapter unavailable — single-instance mode only', {
        error: error instanceof Error ? error.message : String(error),
      });
      adapterPub?.disconnect();
      adapterSub?.disconnect();
      adapterPub = null;
      adapterSub = null;
    }
  } else {
    logger.info('REDIS_URL not set — Socket.IO running in single-instance mode');
  }

  io.use(async (socket, next) => {
    try {
      const token = resolveTokenFromHandshake(
        socket.handshake.headers.authorization,
        socket.handshake.auth?.token
      );
      if (!token) return next(new Error('Unauthorized'));

      const authUser = verifyAccessToken(token);
      if (await isUserBanned(authUser.sub)) return next(new Error('Account suspended'));
      socket.data.userId = authUser.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    // Register every handler synchronously, BEFORE any await: events a client
    // emits right after connecting would otherwise arrive with no listener and be
    // silently dropped.
    socket.on('message:send', async (payload: unknown) => {
      const input = parseMessageSend(payload);
      if (!input) return;
      try {
        const result = await sendDirectMessage(userId, input);
        if (result.ok) socket.emit('message:delivered', { messageId: result.message.id });
        else socket.emit('message:error', { message: result.message });
      } catch (error) {
        logger.warn('Socket message:send failed', { error: String(error) });
      }
    });

    socket.on('room:join', async (payload: unknown) => {
      const roomId = parseId(payload, 'roomId');
      if (!roomId) return;
      try {
        const membership = await prisma.roomMembership.findUnique({
          where: { roomId_userId: { roomId, userId } },
        });
        if (membership) socket.join(`room:${roomId}`);
      } catch (error) {
        logger.warn('Socket room:join failed', { error: String(error) });
      }
    });

    const relayTyping = (event: 'typing:start' | 'typing:stop') => async (payload: unknown) => {
      const recipientId = parseId(payload, 'recipientId');
      if (!recipientId || recipientId === userId) return;
      try {
        if (!(await consumeUserBudget(BUDGETS.typing, userId))) return;
        if (await isBlockedPairCached(userId, recipientId)) return;
        io?.to(`user:${recipientId}`).emit(event, { senderId: userId });
      } catch (error) {
        logger.warn(`Socket ${event} failed`, { error: String(error) });
      }
    };
    socket.on('typing:start', relayTyping('typing:start'));
    socket.on('typing:stop', relayTyping('typing:stop'));

    // Then the slower setup work — failures are non-fatal.
    void (async () => {
      try {
        const memberships = await prisma.roomMembership.findMany({ where: { userId }, select: { roomId: true } });
        for (const { roomId } of memberships) socket.join(`room:${roomId}`);
        await prisma.profile.updateMany({ where: { userId }, data: { lastActive: new Date() } });
      } catch (error) {
        logger.warn('Socket connection setup failed', { error: String(error) });
      }
    })();
  });

  return io;
}

export function getSocketServer() {
  return io;
}

export async function closeSocketServer() {
  adapterPub?.disconnect();
  adapterSub?.disconnect();
  adapterPub = null;
  adapterSub = null;
}
