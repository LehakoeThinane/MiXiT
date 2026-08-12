import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { getSocketServer } from '../../shared/realtime/socket.js';

const defaultRooms = [
  { slug: 'amapiano-lovers', name: 'Amapiano Lovers', emoji: '🎵', city: 'JHB', description: 'Music lovers and playlists' },
  { slug: 'young-hustlers', name: 'Young Hustlers', emoji: '💼', city: 'JHB', description: 'Business and side-hustle conversations' },
  { slug: 'soweto-cafe-scene', name: 'Soweto Cafe Scene', emoji: '☕', city: 'Soweto', description: 'Coffee spots and hangouts' },
  { slug: 'sunset-singles', name: 'Sunset Singles', emoji: '☀️', city: 'JHB', description: 'Meetups and relaxed chats' },
];

async function ensureSeedRooms() {
  await Promise.all(
    defaultRooms.map((room) =>
      prisma.room.upsert({
        where: { slug: room.slug },
        create: room,
        update: {
          name: room.name,
          emoji: room.emoji,
          city: room.city,
          description: room.description,
        },
      })
    )
  );
}

const roomsRoutes: FastifyPluginAsync = async (fastify) => {
  ensureSeedRooms().catch(() => {});

  fastify.get('/list', { preHandler: [fastify.authenticate] }, async (req) => {
    const currentUserId = req.user.sub;
    const rooms = await prisma.room.findMany({
      include: {
        memberships: {
          select: { userId: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    return {
      ok: true,
      rooms: rooms.map((room) => {
        const memberCount = room.memberships.length;
        const joined = room.memberships.some((membership) => membership.userId === currentUserId);
        return {
          id: room.id,
          slug: room.slug,
          name: room.name,
          emoji: room.emoji ?? '💬',
          city: room.city ?? 'Nearby',
          description: room.description,
          memberCount,
          joined,
        };
      }),
    };
  });

  fastify.post<{
    Params: { roomId: string };
  }>('/join/:roomId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const roomId = req.params.roomId;
    if (!roomId) return reply.code(400).send({ ok: false, message: 'Missing room id' });

    await prisma.roomMembership.upsert({
      where: { roomId_userId: { roomId, userId: req.user.sub } },
      create: { roomId, userId: req.user.sub },
      update: {},
    });

    return { ok: true };
  });

  fastify.delete<{
    Params: { roomId: string };
  }>('/join/:roomId', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const roomId = req.params.roomId;
    if (!roomId) return reply.code(400).send({ ok: false, message: 'Missing room id' });

    await prisma.roomMembership.deleteMany({
      where: { roomId, userId: req.user.sub },
    });

    return { ok: true };
  });

  fastify.get<{
    Params: { roomId: string };
    Querystring: { before?: string; limit?: string };
  }>('/:roomId/messages', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const { roomId } = req.params;
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const before = req.query.before ? new Date(req.query.before) : undefined;

    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
    if (!room) return reply.code(404).send({ ok: false, message: 'Room not found' });

    const messages = await prisma.roomMessage.findMany({
      where: {
        roomId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: {
        user: {
          select: {
            profile: { select: { displayName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      ok: true,
      messages: messages.reverse().map((m) => ({
        id: m.id,
        roomId: m.roomId,
        userId: m.userId,
        senderName: m.user.profile?.displayName ?? 'MiXiT user',
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });

  fastify.post<{
    Params: { roomId: string };
    Body: { content: string };
  }>(
    '/:roomId/messages',
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: { content: { type: 'string', minLength: 1, maxLength: 2000 } },
        },
      },
    },
    async (req, reply) => {
    const { roomId } = req.params;
    const { content } = req.body ?? {};
    if (!content?.trim()) return reply.code(400).send({ ok: false, message: 'content required' });

    const room = await prisma.room.findUnique({ where: { id: roomId }, select: { id: true } });
    if (!room) return reply.code(404).send({ ok: false, message: 'Room not found' });

    const membership = await prisma.roomMembership.findUnique({
      where: { roomId_userId: { roomId, userId: req.user.sub } },
    });
    if (!membership) return reply.code(403).send({ ok: false, message: 'Join the room before posting' });

    const [message, senderProfile] = await Promise.all([
      prisma.roomMessage.create({
        data: { roomId, userId: req.user.sub, content: content.trim() },
      }),
      prisma.profile.findUnique({ where: { userId: req.user.sub }, select: { displayName: true } }),
    ]);

    const payload = {
      id: message.id,
      roomId: message.roomId,
      userId: message.userId,
      senderName: senderProfile?.displayName ?? 'MiXiT user',
      content: message.content,
      createdAt: message.createdAt.toISOString(),
    };

    getSocketServer()?.to(`room:${roomId}`).emit('room:message', payload);

    return { ok: true, message: payload };
  });
};

export default roomsRoutes;
