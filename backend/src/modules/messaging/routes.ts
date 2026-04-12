import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';

function formatPreview(type: string, content: string | null) {
  if (type === 'voice') return 'Voice note';
  if (type === 'image') return 'Photo';
  if (content && content.trim().length > 0) return content.trim();
  return 'Start the conversation';
}

const messagingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/conversations', { preHandler: [fastify.authenticate] }, async (req) => {
    const currentUserId = req.user.sub;

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

    const seenPeerIds = new Set<string>();
    const conversations: Array<{
      id: string;
      name: string;
      initial: string;
      preview: string;
      lastMessageAt: string;
      online: boolean;
    }> = [];

    for (const message of messages) {
      const isMine = message.senderId === currentUserId;
      const peer = isMine ? message.recipient : message.sender;
      const peerProfile = peer.profile;

      if (seenPeerIds.has(peer.id)) continue;
      seenPeerIds.add(peer.id);

      conversations.push({
        id: peer.id,
        name: peerProfile?.displayName ?? peer.phone,
        initial: (peerProfile?.displayName ?? peer.phone).slice(0, 1).toUpperCase(),
        preview: formatPreview(message.type, message.content),
        lastMessageAt: message.createdAt.toISOString(),
        online:
          peerProfile?.lastActive !== null && peerProfile?.lastActive !== undefined
            ? Date.now() - peerProfile.lastActive.getTime() <= 5 * 60 * 1000
            : false,
      });
    }

    return { ok: true, conversations };
  });
};

export default messagingRoutes;
