import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { visibleUserFilter } from '../../shared/moderation/actions.js';
import { getBlockedUserIds } from '../../shared/moderation/blocks.js';
import { checkText, FILTERED_MESSAGE } from '../../shared/moderation/content-filter.js';
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

    // Next upcoming (or currently live) event per room, for the "Next: Fri 20:00" line.
    const liveWindowMs = 2 * 60 * 60 * 1000;
    const events = await prisma.roomEvent.findMany({
      where: {
        roomId: { in: rooms.map((room) => room.id) },
        cancelledAt: null,
        startsAt: { gte: new Date(Date.now() - liveWindowMs) },
        host: visibleUserFilter,
      },
      orderBy: { startsAt: 'asc' },
      select: { roomId: true, title: true, kind: true, startsAt: true, endsAt: true },
    });
    const nextEventByRoom = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      const end = event.endsAt ?? new Date(event.startsAt.getTime() + liveWindowMs);
      if (end.getTime() > Date.now() && !nextEventByRoom.has(event.roomId)) nextEventByRoom.set(event.roomId, event);
    }

    const roomsOut = rooms.map((room) => {
      const memberCount = room.memberships.length;
      const joined = room.memberships.some((membership) => membership.userId === currentUserId);
      const next = nextEventByRoom.get(room.id);
      return {
        id: room.id,
        slug: room.slug,
        name: room.name,
        emoji: room.emoji ?? '💬',
        city: room.city ?? 'Nearby',
        description: room.description,
        memberCount,
        joined,
        nextEvent: next
          ? {
              title: next.title,
              kind: next.kind,
              startsAt: next.startsAt.toISOString(),
              isLive: next.startsAt.getTime() <= Date.now(),
            }
          : null,
      };
    });
    // Rooms with something live or coming up float to the top.
    roomsOut.sort((a, b) => {
      const ta = a.nextEvent ? new Date(a.nextEvent.startsAt).getTime() : Infinity;
      const tb = b.nextEvent ? new Date(b.nextEvent.startsAt).getTime() : Infinity;
      return ta === tb ? 0 : ta - tb;
    });

    return { ok: true, rooms: roomsOut };
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

    const blockedUserIds = await getBlockedUserIds(req.user.sub);
    const messages = await prisma.roomMessage.findMany({
      where: {
        roomId,
        userId: { notIn: Array.from(blockedUserIds) },
        user: visibleUserFilter,
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
    if (!checkText(content).ok) return reply.code(422).send({ ok: false, message: FILTERED_MESSAGE });

    const sender = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { heldAt: true } });
    if (sender?.heldAt) {
      return reply.code(403).send({ ok: false, message: 'Your account is under review. You can post in rooms again once it has been checked.' });
    }

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
