import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { sendDirectMessage, toClientMessages } from '../../shared/messaging/direct-messages.js';
import { getBlockedUserIds } from '../../shared/moderation/blocks.js';
import { getSocketServer } from '../../shared/realtime/socket.js';
import { publicIdentity } from '../../shared/users/public-identity.js';
import { createSignedChatMediaUrl } from '../../shared/storage/supabase-storage.js';

type SendMessageBody = {
  recipientId: string;
  content?: string;
  type?: 'text' | 'voice' | 'image';
  mediaUrl?: string;
};

function formatPreview(type: string, content: string | null) {
  if (type === 'voice') return 'Voice note';
  if (type === 'image') return 'Photo';
  if (content && content.trim().length > 0) return content.trim();
  return 'Start the conversation';
}

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

  fastify.get('/conversations', { preHandler: [fastify.authenticate] }, async (req) => {
    const currentUserId = req.user.sub;
    const blockedUserIds = await getBlockedUserIds(currentUserId);

    const messages = await prisma.message.findMany({
      where: {
        OR: [{ senderId: currentUserId }, { recipientId: currentUserId }],
      },
      // Only what the list shows — never load (or risk returning) email/phone.
      include: {
        sender: { select: peerSelect },
        recipient: { select: peerSelect },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });

    const unreadPeerIds = new Set(
      messages.filter((m) => m.recipientId === currentUserId && !m.readAt).map((m) => m.senderId)
    );

    const seenPeerIds = new Set<string>();
    const conversations: Array<{
      id: string;
      name: string;
      initial: string;
      preview: string;
      lastMessageAt: string;
      online: boolean;
      unread: boolean;
    }> = [];

    for (const message of messages) {
      const isMine = message.senderId === currentUserId;
      const peer = isMine ? message.recipient : message.sender;
      // Banned and held (under review) users are hidden, as everywhere else.
      if (seenPeerIds.has(peer.id) || blockedUserIds.has(peer.id) || peer.bannedAt || peer.heldAt) continue;
      seenPeerIds.add(peer.id);
      const identity = publicIdentity(peer.id, peer.profile);

      conversations.push({
        id: peer.id,
        name: identity.displayName,
        initial: identity.initial,
        preview: formatPreview(message.type, message.content),
        lastMessageAt: message.createdAt.toISOString(),
        online: identity.online,
        unread: unreadPeerIds.has(peer.id),
      });
    }

    return { ok: true, conversations };
  });

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
