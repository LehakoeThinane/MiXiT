import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

import { extractBearerToken, verifyAccessToken } from '../auth/jwt.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { isUserBanned } from '../moderation/actions.js';
import { sendDirectMessage } from '../messaging/direct-messages.js';
import { logger } from '../utils/logger.js';

let io: Server | null = null;
let adapterPub: Redis | null = null;
let adapterSub: Redis | null = null;

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

  io.on('connection', async (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    // Auto-join all room channels the user is a member of
    try {
      const memberships = await prisma.roomMembership.findMany({
        where: { userId },
        select: { roomId: true },
      });
      for (const { roomId } of memberships) {
        socket.join(`room:${roomId}`);
      }
    } catch {
      // non-fatal — user can still chat in rooms they navigate to
    }

    await prisma.profile.updateMany({
      where: { userId },
      data: { lastActive: new Date() },
    });

    socket.on('message:send', async (payload: { recipientId: string; content?: string; type?: string; mediaUrl?: string }) => {
      if (!payload?.recipientId) return;
      try {
        const result = await sendDirectMessage(userId, payload);
        if (result.ok) socket.emit('message:delivered', { messageId: result.message.id });
        else socket.emit('message:error', { message: result.message });
      } catch (error) {
        logger.warn('Socket message:send failed', { error: String(error) });
      }
    });

    socket.on('room:join', async ({ roomId }: { roomId: string }) => {
      if (!roomId) return;
      const membership = await prisma.roomMembership.findUnique({
        where: { roomId_userId: { roomId, userId } },
      });
      if (membership) socket.join(`room:${roomId}`);
    });

    socket.on('typing:start', ({ recipientId }: { recipientId: string }) => {
      if (recipientId) io?.to(`user:${recipientId}`).emit('typing:start', { senderId: userId });
    });

    socket.on('typing:stop', ({ recipientId }: { recipientId: string }) => {
      if (recipientId) io?.to(`user:${recipientId}`).emit('typing:stop', { senderId: userId });
    });

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
