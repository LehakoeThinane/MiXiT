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
    const profiles = await prisma.profile.findMany({
      where: {
        userId: {
          not: req.user.sub,
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

  fastify.get('/vibes', { preHandler: [fastify.authenticate] }, async (req) => {
    const profiles = await prisma.profile.findMany({
      where: {
        userId: {
          not: req.user.sub,
        },
      },
      orderBy: [{ lastActive: 'desc' }, { updatedAt: 'desc' }],
      take: 20,
    });

    const vibes = profiles.map((profile, index) => mapProfileToDiscoverCard(profile, index, 'Near you'));
    return { ok: true, vibes };
  });
};

export default matchingRoutes;
