import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';

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
  fastify.get('/list', { preHandler: [fastify.authenticate] }, async (req) => {
    await ensureSeedRooms();

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
};

export default roomsRoutes;
