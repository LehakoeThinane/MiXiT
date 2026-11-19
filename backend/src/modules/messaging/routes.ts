import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { sendDirectMessage, toClientMessages } from '../../shared/messaging/direct-messages.js';
import { listConversations } from '../../shared/messaging/conversations.js';
import { getSocketServer } from '../../shared/realtime/socket.js';
import { publicIdentity } from '../../shared/users/public-identity.js';
import { createSignedChatMediaUrl } from '../../shared/storage/supabase-storage.js';

type SendMessageBody = {
  recipientId: string;
  content?: string;
  type?: 'text' | 'voice' | 'image';
  mediaUrl?: string;
};

const peerSelect = {
  id: true,
  bannedAt: true,
  heldAt: true,
  profile: { select: { displayName: true, lastActive: true, showLastSeen: true } },
} as const;

const messagingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/media-upload',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['filename', 'mimeType'],
          properties: {
            filename: { type: 'string', minLength: 1, maxLength: 255 },
            mimeType: {
              type: 'string',
              enum: ['image/jpeg', 'image/png', 'image/webp', 'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/mpeg', 'audio/aac'],
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { filename, mimeType } = req.body as { filename: string; mimeType: string };
      try {
        const { signedUrl, publicUrl } = await createSignedChatMediaUrl(req.user.sub, filename);
        return { ok: true, signedUrl, publicUrl, mimeType };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to prepare media upload';
        return reply.code(500).send({ ok: false, message });
      }
    }
  );

  // One row per person, newest first; blocked/banned/held peers excluded.
  // Next page: pass the last row's lastMessageAt + lastMessageId as before/beforeId.
  fastify.get<{ Querystring: { limit?: number; before?: string; beforeId?: string } }>(
    '/conversations',
    {
      preHandler: [fastify.authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            before: { type: 'string', format: 'date-time' },
            beforeId: { type: 'string', minLength: 1, maxLength: 36 },
          },
          dependencies: { before: ['beforeId'], beforeId: ['before'] },
        },
      },
    },
    async (req) => {
      const { limit = 50, before, beforeId } = req.query;
      const result = await listConversations(req.user.sub, {
        limit,
        cursor: before && beforeId ? { before: new Date(before), beforeId } : undefined,
      });
      return { ok: true, ...result };
    }
  );

  // Newest page first. Older pages: pass the oldest message you have as the cursor
  // (`before` = its createdAt, `beforeId` = its id). `id` breaks createdAt ties so
  // pages never overlap or skip. Messages in each page are returned oldest-first.
  fastify.get<{
    Params: { peerUserId: string };
    Querystring: { limit?: number; before?: string; beforeId?: string };
  }>(
    '/thread/:peerUserId',
    {
      preHandler: [fastify.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['peerUserId'],
          properties: { peerUserId: { type: 'string', minLength: 1, maxLength: 36 } },
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            before: { type: 'string', format: 'date-time' },
            beforeId: { type: 'string', minLength: 1, maxLength: 36 },
          },
          dependencies: { before: ['beforeId'], beforeId: ['before'] },
        },
      },
    },
    async (req) => {
    const currentUserId = req.user.sub;
    const peerUserId = req.params.peerUserId;
    const limit = req.query.limit ?? 50;
    const before = req.query.before ? new Date(req.query.before) : null;

    const page = await prisma.message.findMany({
      where: {
        AND: [
          {
            OR: [
              { senderId: currentUserId, recipientId: peerUserId },
              { senderId: peerUserId, recipientId: currentUserId },
            ],
          },
          before
            ? {
                OR: [
                  { createdAt: { lt: before } },
                  { createdAt: before, id: { lt: req.query.beforeId } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // one extra row tells us whether an older page exists
    });
    const hasMore = page.length > limit;
    const messages = page.slice(0, limit).reverse();

    // Mark unread incoming messages in this page as read
    const unreadIds = messages
      .filter((m) => m.recipientId === currentUserId && !m.readAt)
      .map((m) => m.id);

    if (unreadIds.length > 0) {
      await prisma.message.updateMany({
        where: { id: { in: unreadIds } },
        data: { readAt: new Date() },
      });
      const io = getSocketServer();
      io?.to(`user:${peerUserId}`).emit('message:read', { byUserId: currentUserId, messageIds: unreadIds });
    }

    // Who the chat is with, so the app never needs names in the URL.
    const peer = await prisma.user.findUnique({ where: { id: peerUserId }, select: peerSelect });
    const peerIdentity = publicIdentity(peerUserId, peer && !peer.bannedAt && !peer.heldAt ? peer.profile : null);

    return { ok: true, messages: await toClientMessages(messages), hasMore, peer: peerIdentity };
    }
  );

  fastify.post<{
    Body: SendMessageBody;
  }>(
    '/messages',
    {
      preHandler: [fastify.authenticate],
      // Per-user DM budget (shared with socket sends) is enforced in sendDirectMessage.
      schema: {
        body: {
          type: 'object',
          required: ['recipientId'],
          properties: {
            recipientId: { type: 'string', minLength: 1, maxLength: 36 },
            content: { type: 'string', maxLength: 4000 },
            type: { type: 'string', enum: ['text', 'voice', 'image'] },
            mediaUrl: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await sendDirectMessage(req.user.sub, req.body);
      if (!result.ok) return reply.code(result.status).send({ ok: false, message: result.message });
      return { ok: true, message: result.message };
    }
  );
};

export default messagingRoutes;
