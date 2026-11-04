import type { RoomEvent } from '@prisma/client';
import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { visibleUserFilter } from '../../shared/moderation/actions.js';
import { checkText, FILTERED_MESSAGE } from '../../shared/moderation/content-filter.js';
import { sendPushNotifications } from '../../shared/push/expo-push.js';

// Room sessions (live chat at a set time) and meetups (real-world, with a venue).
// Only hosts — users an admin marked with isHost — can schedule them.

const LIVE_WINDOW_MS = 2 * 60 * 60 * 1000; // an event without endsAt counts as live for 2h
const MAX_AHEAD_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_DURATION_MS = 12 * 60 * 60 * 1000;

type EventWithExtras = RoomEvent & {
  host: { profile: { displayName: string } | null };
  room: { name: string; emoji: string | null };
  _count: { rsvps: number };
  rsvps: { userId: string }[];
};

const eventInclude = (userId: string) =>
  ({
    host: { select: { profile: { select: { displayName: true } } } },
    room: { select: { name: true, emoji: true } },
    _count: { select: { rsvps: true } },
    rsvps: { where: { userId }, select: { userId: true } },
  }) as const;

function endOf(event: RoomEvent) {
  return event.endsAt ?? new Date(event.startsAt.getTime() + LIVE_WINDOW_MS);
}

function serialize(event: EventWithExtras, userId: string, isHost: boolean) {
  const now = Date.now();
  return {
    id: event.id,
    roomId: event.roomId,
    roomName: event.room.name,
    roomEmoji: event.room.emoji ?? '💬',
    kind: event.kind,
    title: event.title,
    description: event.description,
    venue: event.venue,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    hostName: event.host.profile?.displayName ?? 'MiXiT host',
    rsvpCount: event._count.rsvps,
    going: event.rsvps.length > 0,
    isLive: event.startsAt.getTime() <= now && endOf(event).getTime() > now,
    canCancel: event.hostId === userId || isHost,
  };
}

/** Upcoming or currently-live, not cancelled. */
function upcomingWhere() {
  return { cancelledAt: null, startsAt: { gte: new Date(Date.now() - LIVE_WINDOW_MS) } };
}

async function isHostUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isHost: true } });
  return Boolean(user?.isHost);
}

type CreateEventBody = {
  kind: 'session' | 'meetup';
  title: string;
  description?: string;
  venue?: string;
  startsAt: string;
  endsAt?: string;
};

const eventRoutes: FastifyPluginAsync = async (fastify) => {
  // ---- Events in one room ----
  fastify.get<{ Params: { roomId: string } }>(
    '/room/:roomId',
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const userId = req.user.sub;
      const [events, isHost] = await Promise.all([
        prisma.roomEvent.findMany({
          where: { roomId: req.params.roomId, ...upcomingWhere(), host: visibleUserFilter },
          include: eventInclude(userId),
          orderBy: { startsAt: 'asc' },
          take: 20,
        }),
        isHostUser(userId),
      ]);
      return {
        ok: true,
        canHost: isHost,
        events: events
          .filter((e) => endOf(e).getTime() > Date.now())
          .map((e) => serialize(e as EventWithExtras, userId, isHost)),
      };
    }
  );

  // ---- Upcoming events across all rooms (for the Rooms tab) ----
  fastify.get('/upcoming', { preHandler: [fastify.authenticate] }, async (req) => {
    const userId = req.user.sub;
    const [events, isHost] = await Promise.all([
      prisma.roomEvent.findMany({
        where: { ...upcomingWhere(), host: visibleUserFilter },
        include: eventInclude(userId),
        orderBy: { startsAt: 'asc' },
        take: 30,
      }),
      isHostUser(userId),
    ]);
    return {
      ok: true,
      canHost: isHost,
      events: events
        .filter((e) => endOf(e).getTime() > Date.now())
        .map((e) => serialize(e as EventWithExtras, userId, isHost)),
    };
  });

  // ---- Schedule an event (hosts only) ----
  fastify.post<{ Params: { roomId: string }; Body: CreateEventBody }>(
    '/room/:roomId',
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['kind', 'title', 'startsAt'],
          properties: {
            kind: { type: 'string', enum: ['session', 'meetup'] },
            title: { type: 'string', minLength: 3, maxLength: 80 },
            description: { type: 'string', maxLength: 500 },
            venue: { type: 'string', maxLength: 160 },
            startsAt: { type: 'string', format: 'date-time' },
            endsAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (req, reply) => {
      const userId = req.user.sub;
      if (!(await isHostUser(userId))) {
        return reply.code(403).send({ ok: false, message: 'Only MiXiT hosts can schedule room events.' });
      }

      const room = await prisma.room.findUnique({ where: { id: req.params.roomId }, select: { id: true, name: true } });
      if (!room) return reply.code(404).send({ ok: false, message: 'Room not found' });

      const { kind, title, description, venue } = req.body;
      const startsAt = new Date(req.body.startsAt);
      const endsAt = req.body.endsAt ? new Date(req.body.endsAt) : null;
      const now = Date.now();

      if (startsAt.getTime() < now - 5 * 60 * 1000) {
        return reply.code(400).send({ ok: false, message: 'Start time must be in the future.' });
      }
      if (startsAt.getTime() > now + MAX_AHEAD_MS) {
        return reply.code(400).send({ ok: false, message: 'Events can be scheduled up to 90 days ahead.' });
      }
      if (endsAt && (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > MAX_DURATION_MS)) {
        return reply.code(400).send({ ok: false, message: 'End time must be after the start and within 12 hours.' });
      }
      if (kind === 'meetup' && !venue?.trim()) {
        return reply.code(400).send({ ok: false, message: 'Meetups need a venue.' });
      }
      if (!checkText(title, description, venue).ok) {
        return reply.code(422).send({ ok: false, message: FILTERED_MESSAGE });
      }

      const event = await prisma.roomEvent.create({
        data: {
          roomId: room.id,
          hostId: userId,
          kind,
          title: title.trim(),
          description: description?.trim() || null,
          venue: kind === 'meetup' ? venue!.trim() : null,
          startsAt,
          endsAt,
        },
        include: eventInclude(userId),
      });

      // Let room members know (fire-and-forget).
      void prisma.roomMembership
        .findMany({
          where: { roomId: room.id, userId: { not: userId } },
          select: { user: { select: { profile: { select: { pushToken: true } } } } },
        })
        .then((members) =>
          sendPushNotifications(
            members.map((m) => m.user.profile?.pushToken),
            `${kind === 'meetup' ? 'New meetup' : 'New session'} in ${room.name}`,
            `${event.title} — ${startsAt.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
            { type: 'room_event', roomId: room.id, eventId: event.id }
          )
        )
        .catch(() => undefined);

      return { ok: true, event: serialize(event as EventWithExtras, userId, true) };
    }
  );

  // ---- Cancel (the host who created it, or any host) ----
  fastify.delete<{ Params: { eventId: string } }>(
    '/:eventId',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.sub;
      const event = await prisma.roomEvent.findUnique({
        where: { id: req.params.eventId },
        include: { rsvps: { select: { user: { select: { profile: { select: { pushToken: true } } } } } } },
      });
      if (!event || event.cancelledAt) return reply.code(404).send({ ok: false, message: 'Event not found' });
      if (event.hostId !== userId && !(await isHostUser(userId))) {
        return reply.code(403).send({ ok: false, message: 'Only the host can cancel this event.' });
      }
      await prisma.roomEvent.update({ where: { id: event.id }, data: { cancelledAt: new Date() } });
      void sendPushNotifications(
        event.rsvps.map((r) => r.user.profile?.pushToken),
        'Event cancelled',
        `"${event.title}" has been cancelled.`,
        { type: 'room_event', roomId: event.roomId, eventId: event.id }
      );
      return { ok: true };
    }
  );

  // ---- RSVP ----
  fastify.post<{ Params: { eventId: string } }>(
    '/:eventId/rsvp',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const event = await prisma.roomEvent.findUnique({ where: { id: req.params.eventId } });
      if (!event || event.cancelledAt || endOf(event).getTime() < Date.now()) {
        return reply.code(404).send({ ok: false, message: 'Event not found' });
      }
      await prisma.roomEventRsvp.upsert({
        where: { eventId_userId: { eventId: event.id, userId: req.user.sub } },
        create: { eventId: event.id, userId: req.user.sub },
        update: {},
      });
      return { ok: true };
    }
  );

  fastify.delete<{ Params: { eventId: string } }>(
    '/:eventId/rsvp',
    { preHandler: [fastify.authenticate] },
    async (req) => {
      await prisma.roomEventRsvp.deleteMany({ where: { eventId: req.params.eventId, userId: req.user.sub } });
      return { ok: true };
    }
  );
};

export default eventRoutes;
