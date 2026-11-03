import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { sendDirectMessage, toClientMessages } from '../../shared/messaging/direct-messages.js';
import { getBlockedUserIds } from '../../shared/moderation/blocks.js';
import { getSocketServer } from '../../shared/realtime/socket.js';
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
      include: {
        sender: {
          include: { profile: true },
        },
        recipient: {
          include: { profile: true },
        },
      },
      orderBy: { createdAt: 'desc' },
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
      const peerProfile = peer.profile;

      if (seenPeerIds.has(peer.id) || blockedUserIds.has(peer.id) || peer.bannedAt) continue;
      seenPeerIds.add(peer.id);

      conversations.push({
        id: peer.id,
        name: peerProfile?.displayName ?? peer.email,
        initial: (peerProfile?.displayName ?? peer.email).slice(0, 1).toUpperCase(),
        preview: formatPreview(message.type, message.content),
        lastMessageAt: message.createdAt.toISOString(),
        online:
          peerProfile?.lastActive !== null && peerProfile?.lastActive !== undefined
            ? Date.now() - peerProfile.lastActive.getTime() <= 5 * 60 * 1000
            : false,
        unread: unreadPeerIds.has(peer.id),
      });
    }

    return { ok: true, conversations };
  });

  fastify.get<{
    Params: { peerUserId: string };
    Querystring: { limit?: string };
  }>('/thread/:peerUserId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const currentUserId = req.user.sub;
    const peerUserId = req.params.peerUserId;

    if (!peerUserId) {
      return reply.code(400).send({ ok: false, message: 'Missing peer user id' });
    }

    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId, recipientId: peerUserId },
          { senderId: peerUserId, recipientId: currentUserId },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    // Mark unread incoming messages as read
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

    return { ok: true, messages: await toClientMessages(messages) };
  });

  fastify.post<{
    Body: SendMessageBody;
  }>(
    '/messages',
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
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
