import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

import { ensureRedisConnection, redis } from '../cache/redis.js';
import { extractBearerToken, verifyAccessToken } from '../auth/jwt.js';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { sendPushNotification } from '../push/expo-push.js';
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
      socket.data.userId = authUser.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    try {
      await ensureRedisConnection();
      await redis.setex(`presence:${userId}`, 300, 'online');
    } catch {
      // presence tracking unavailable — non-fatal
    }
    await prisma.profile.updateMany({
      where: { userId },
      data: { lastActive: new Date() },
    });

    socket.on('message:send', async (payload: { recipientId: string; content?: string; type?: string; mediaUrl?: string }) => {
      if (!payload?.recipientId) return;
      if (!payload.content && !payload.mediaUrl) return;

      const recipientExists = await prisma.user.findUnique({ where: { id: payload.recipientId }, select: { id: true } });
      if (!recipientExists) return;

      const type = payload.type ?? 'text';
      const message = await prisma.message.create({
        data: {
          senderId: userId,
          recipientId: payload.recipientId,
          content: payload.content ?? null,
          mediaUrl: payload.mediaUrl ?? null,
          type,
        },
      });

      io?.to(`user:${payload.recipientId}`).emit('message:received', {
        id: message.id,
        senderId: message.senderId,
        recipientId: message.recipientId,
        content: message.content,
        type: message.type,
        mediaUrl: message.mediaUrl,
        createdAt: message.createdAt.toISOString(),
      });
      socket.emit('message:delivered', { messageId: message.id });

      const [senderProfile, recipientProfile] = await Promise.all([
        prisma.profile.findUnique({ where: { userId }, select: { displayName: true } }),
        prisma.profile.findUnique({ where: { userId: payload.recipientId }, select: { pushToken: true } }),
      ]);
      const preview = type === 'voice' ? 'Sent a voice note' : type === 'image' ? 'Sent a photo' : (payload.content ?? '').slice(0, 100);
      sendPushNotification(recipientProfile?.pushToken, senderProfile?.displayName ?? 'Someone', preview, { type: 'message', senderId: userId }).catch(() => {});
    });

    socket.on('typing:start', ({ recipientId }: { recipientId: string }) => {
      if (recipientId) io?.to(`user:${recipientId}`).emit('typing:start', { senderId: userId });
    });

    socket.on('typing:stop', ({ recipientId }: { recipientId: string }) => {
      if (recipientId) io?.to(`user:${recipientId}`).emit('typing:stop', { senderId: userId });
    });

    socket.on('disconnect', async () => {
      try {
        await redis.del(`presence:${userId}`);
      } catch {
        // ignore — presence cleanup is best-effort
      }
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
