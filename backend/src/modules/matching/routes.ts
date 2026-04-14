import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';

function deriveTagsFromBio(bio: string | null) {
  if (!bio) return ['MiXiT'];
  if (bio.toLowerCase().startsWith('into ')) {
    return bio
      .slice(5)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 4);
  }
  return ['MiXiT'];
}

function mapProfileToDiscoverCard(
  profile: {
    userId: string;
    displayName: string;
    age: number;
    bio: string | null;
    lastActive: Date | null;
  },
  index: number,
  city: string
) {
  const distanceKm = (2.1 + index * 1.3).toFixed(1);
  const tags = deriveTagsFromBio(profile.bio ?? null);

  return {
    id: profile.userId,
    name: profile.displayName,
    age: profile.age,
    distance: `${distanceKm}km away`,
    city,
    tags,
    bio: profile.bio ?? 'MiXiT member',
    initial: profile.displayName.slice(0, 1).toUpperCase(),
    voiceDuration: '0:20',
    online:
      profile.lastActive !== null
        ? Date.now() - profile.lastActive.getTime() <= 5 * 60 * 1000
        : false,
  };
}

const matchingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/candidates', { preHandler: [fastify.authenticate] }, async (req) => {
    const currentUserId = req.user.sub;

    const mySentVibes = await prisma.vibe.findMany({
      where: { fromUserId: currentUserId },
      select: { toUserId: true },
    });
    const excludedUserIds = new Set<string>(mySentVibes.map((item) => item.toUserId));
    excludedUserIds.add(currentUserId);

    const profiles = await prisma.profile.findMany({
      where: {
        userId: {
          notIn: Array.from(excludedUserIds),
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    const candidates = profiles.map((profile, index) =>
      mapProfileToDiscoverCard(profile, index, 'Nearby')
    );

    return { ok: true, candidates };
  });

  fastify.post<{
    Body: { toUserId: string };
  }>('/vibe', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const fromUserId = req.user.sub;
    const { toUserId } = req.body;

    if (!toUserId || typeof toUserId !== 'string') {
      return reply.code(400).send({ ok: false, message: 'Invalid recipient' });
    }
    if (toUserId === fromUserId) {
      return reply.code(400).send({ ok: false, message: 'Cannot vibe yourself' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: toUserId }, select: { id: true } });
    if (!targetUser) {
      return reply.code(404).send({ ok: false, message: 'User not found' });
    }

    await prisma.vibe.upsert({
      where: {
        fromUserId_toUserId: {
          fromUserId,
          toUserId,
        },
      },
      create: { fromUserId, toUserId },
      update: {},
    });

    const reverseVibe = await prisma.vibe.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: toUserId,
          toUserId: fromUserId,
        },
      },
    });

    let matched = false;
    if (reverseVibe) {
      matched = true;
      const now = new Date();
      await prisma.vibe.updateMany({
        where: {
          OR: [
            { fromUserId, toUserId },
            { fromUserId: toUserId, toUserId: fromUserId },
          ],
        },
        data: { matchedAt: now },
      });
    }

    return { ok: true, matched };
  });

  fastify.get('/vibes', { preHandler: [fastify.authenticate] }, async (req) => {
    const currentUserId = req.user.sub;

    const incomingVibes = await prisma.vibe.findMany({
      where: { toUserId: currentUserId },
      include: {
        fromUser: {
          include: { profile: true },
        },
      },
      orderBy: [{ matchedAt: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    });

    const vibes = incomingVibes
      .filter((item) => item.fromUser.profile)
      .map((item, index) =>
        mapProfileToDiscoverCard(
          {
            userId: item.fromUserId,
            displayName: item.fromUser.profile?.displayName ?? item.fromUser.phone,
            age: item.fromUser.profile?.age ?? 25,
            bio: item.fromUser.profile?.bio ?? null,
            lastActive: item.fromUser.profile?.lastActive ?? null,
          },
          index,
          'Near you'
        )
      );

    return { ok: true, vibes };
  });
};

export default matchingRoutes;
