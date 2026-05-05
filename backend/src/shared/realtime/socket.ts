import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';

import { ensureRedisConnection, redis } from '../cache/redis.js';
import { authenticateSupabaseToken, resolveBearerToken } from '../auth/supabase-auth.js';
import { prisma } from '../db/prisma.js';

let io: Server | null = null;

function resolveTokenFromHandshake(authHeader: string | string[] | undefined, authToken?: unknown) {
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();
  return resolveBearerToken(authHeader);
}

export function initSocketServer(app: FastifyInstance) {
  if (io) return io;

  io = new Server(app.server, {
    cors: { origin: true },
    transports: ['websocket', 'polling'],
    pingTimeout: 60_000,
    pingInterval: 25_000,
  });

  io.use(async (socket, next) => {
    try {
      const token = resolveTokenFromHandshake(
        socket.handshake.headers.authorization,
        socket.handshake.auth?.token
      );
      if (!token) return next(new Error('Unauthorized'));

      const authUser = await authenticateSupabaseToken(token);
      socket.data.userId = authUser.sub;
      socket.data.supabaseUserId = authUser.supabaseUserId;
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
