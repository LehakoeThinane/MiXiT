import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { getBlockedUserIds, isBlockedPair } from '../../shared/moderation/blocks.js';
import { sendPushNotification } from '../../shared/push/expo-push.js';

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/** Haversine distance between two lat/lng points in kilometres. */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Compute a human-readable distance string between two profiles. */
function computeDistance(
  myLat: number | null,
  myLng: number | null,
  myCity: string | null,
  theirLat: number | null,
  theirLng: number | null,
  theirCity: string | null
): string {
  if (
    myLat !== null &&
    myLng !== null &&
    theirLat !== null &&
    theirLng !== null
  ) {
    const km = haversineKm(myLat, myLng, theirLat, theirLng);
    if (km < 1) return `${Math.round(km * 1000)}m away`;
    return `${km.toFixed(1)}km away`;
  }

  if (myCity && theirCity && myCity.toLowerCase() === theirCity.toLowerCase()) {
    return 'Same city';
  }

  return 'Nearby';
}

/** Parse a JSON column that may be a string[] or null. */
function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

/**
 * Score a candidate profile against the current user's profile.
 *
 * Breakdown (max 100):
 *   Interest overlap   — up to 50 pts  (10 per shared interest, capped at 5)
 *   Intent alignment   — up to 20 pts  (10 per shared intent, capped at 2)
 *   Recency            — up to 15 pts  (active in last 5 min = 15, last hour = 10, etc.)
 *   Profile completeness — up to 15 pts (photos +5, bio +5, voice intro +5)
 */
function scoreCandidate(
  myInterests: string[],
  myIntents: string[],
  candidate: {
    interests: unknown;
    intents: unknown;
    bio: string | null;
    photos: unknown;
    voiceIntroUrl: string | null;
    lastActive: Date | null;
  }
): number {
  let score = 0;

  // --- Interest overlap (up to 50) ---
  const theirInterests = parseJsonStringArray(candidate.interests).map((s) =>
    s.toLowerCase()
  );
  const myLower = myInterests.map((s) => s.toLowerCase());
  const sharedInterests = myLower.filter((interest) =>
    theirInterests.includes(interest)
  ).length;
  score += Math.min(sharedInterests * 10, 50);

  // --- Intent alignment (up to 20) ---
  const theirIntents = parseJsonStringArray(candidate.intents).map((s) =>
    s.toLowerCase()
  );
  const myIntentsLower = myIntents.map((s) => s.toLowerCase());
  const sharedIntents = myIntentsLower.filter((intent) =>
    theirIntents.includes(intent)
  ).length;
  score += Math.min(sharedIntents * 10, 20);

  // --- Recency (up to 15) ---
  if (candidate.lastActive) {
    const minutesAgo =
      (Date.now() - candidate.lastActive.getTime()) / (1000 * 60);
    if (minutesAgo <= 5) score += 15;
    else if (minutesAgo <= 60) score += 10;
    else if (minutesAgo <= 1440) score += 5; // within 24h
    // older than 24h = 0
  }

  // --- Profile completeness (up to 15) ---
  const hasPhotos = parseJsonStringArray(candidate.photos).length > 0;
  const hasBio = Boolean(candidate.bio && candidate.bio.trim().length > 0);
  const hasVoice = Boolean(candidate.voiceIntroUrl);
  if (hasPhotos) score += 5;
  if (hasBio) score += 5;
  if (hasVoice) score += 5;

  return score;
}

// ---------------------------------------------------------------------------
// Card mapping
// ---------------------------------------------------------------------------

function deriveTagsFromProfile(
  interests: unknown,
  bio: string | null
): string[] {
  const parsed = parseJsonStringArray(interests);
  if (parsed.length > 0) return parsed.slice(0, 4);

  if (bio && bio.toLowerCase().startsWith('into ')) {
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
    interests: unknown;
    lastActive: Date | null;
    voiceIntroUrl?: string | null;
    voiceIntroDurationSec?: number | null;
  },
  distance: string
) {
  const tags = deriveTagsFromProfile(profile.interests, profile.bio);
  const durationSec = profile.voiceIntroDurationSec ?? 0;
  const voiceDuration = durationSec > 0
    ? `0:${String(durationSec).padStart(2, '0')}`
    : '0:00';

  return {
    id: profile.userId,
    name: profile.displayName,
    age: profile.age,
    distance,
    city: distance === 'Same city' || distance === 'Nearby' ? distance : '',
    tags,
    bio: profile.bio ?? 'MiXiT member',
    initial: profile.displayName.slice(0, 1).toUpperCase(),
    voiceIntroUrl: profile.voiceIntroUrl ?? null,
    voiceDuration,
    online:
      profile.lastActive !== null
        ? Date.now() - profile.lastActive.getTime() <= 5 * 60 * 1000
        : false,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const matchingRoutes: FastifyPluginAsync = async (fastify) => {
  // ---- Discover candidates (scored) ----
  fastify.get(
    '/candidates',
    { preHandler: [fastify.authenticate], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const currentUserId = req.user.sub;

      // Fetch the current user's profile for scoring context
      const myProfile = await prisma.profile.findUnique({
        where: { userId: currentUserId },
      });

      const myInterests = parseJsonStringArray(myProfile?.interests);
      const myIntents = parseJsonStringArray(myProfile?.intents);

      // Exclude users we already vibed, and anyone blocked in either direction
      const [mySentVibes, blockedUserIds] = await Promise.all([
        prisma.vibe.findMany({
          where: { fromUserId: currentUserId },
          select: { toUserId: true },
        }),
        getBlockedUserIds(currentUserId),
      ]);
      const excludedUserIds = new Set<string>([
        ...mySentVibes.map((item) => item.toUserId),
        ...blockedUserIds,
      ]);
      excludedUserIds.add(currentUserId);

      const profiles = await prisma.profile.findMany({
        where: {
          userId: { notIn: Array.from(excludedUserIds) },
          completedAt: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
        take: 40,
      });

      // Score and sort candidates
      const scored = profiles.map((profile) => {
        const score = scoreCandidate(myInterests, myIntents, profile);
        const distance = computeDistance(
          myProfile?.locationLat ?? null,
          myProfile?.locationLng ?? null,
          myProfile?.city ?? null,
          profile.locationLat,
          profile.locationLng,
          profile.city
        );
        return { profile, score, distance };
      });

      scored.sort((a, b) => b.score - a.score);

      const candidates = scored
        .slice(0, 20)
        .map(({ profile, distance }) =>
          mapProfileToDiscoverCard(profile, distance)
        );

      return { ok: true, candidates };
    }
  );

  // ---- Send a vibe ----
  fastify.post<{
    Body: { toUserId: string };
  }>(
    '/vibe',
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['toUserId'],
          properties: { toUserId: { type: 'string', minLength: 1, maxLength: 36 } },
        },
      },
    },
    async (req, reply) => {
    const fromUserId = req.user.sub;
    const { toUserId } = req.body;

    if (!toUserId || typeof toUserId !== 'string') {
      return reply.code(400).send({ ok: false, message: 'Invalid recipient' });
    }
    if (toUserId === fromUserId) {
      return reply
        .code(400)
        .send({ ok: false, message: 'Cannot vibe yourself' });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true },
    });
    if (!targetUser) {
      return reply.code(404).send({ ok: false, message: 'User not found' });
    }

    if (await isBlockedPair(fromUserId, toUserId)) {
      return reply.code(403).send({ ok: false, message: 'Cannot vibe this user' });
    }

    await prisma.vibe.upsert({
      where: {
        fromUserId_toUserId: { fromUserId, toUserId },
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

      const [fromProfile, toProfile] = await Promise.all([
        prisma.profile.findUnique({ where: { userId: fromUserId }, select: { displayName: true, pushToken: true } }),
        prisma.profile.findUnique({ where: { userId: toUserId }, select: { displayName: true, pushToken: true } }),
      ]);
      await Promise.all([
        sendPushNotification(fromProfile?.pushToken, "It's a match!", `You and ${toProfile?.displayName ?? 'someone'} vibed each other`, { type: 'match', userId: toUserId }),
        sendPushNotification(toProfile?.pushToken, "It's a match!", `You and ${fromProfile?.displayName ?? 'someone'} vibed each other`, { type: 'match', userId: fromUserId }),
      ]);
    }

    return { ok: true, matched };
  });

  // ---- Retract a sent vibe (before mutual match) ----
  fastify.delete<{
    Params: { userId: string };
  }>(
    '/vibe/:userId',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const fromUserId = req.user.sub;
      const toUserId = req.params.userId;

      if (!toUserId) {
        return reply
          .code(400)
          .send({ ok: false, message: 'Missing user id' });
      }

      // Only allow retraction if not yet mutually matched
      const vibe = await prisma.vibe.findUnique({
        where: {
          fromUserId_toUserId: { fromUserId, toUserId },
        },
      });

      if (!vibe) {
        return reply
          .code(404)
          .send({ ok: false, message: 'Vibe not found' });
      }

      if (vibe.matchedAt) {
        return reply
          .code(400)
          .send({ ok: false, message: 'Cannot retract a matched vibe' });
      }

      await prisma.vibe.delete({
        where: {
          fromUserId_toUserId: { fromUserId, toUserId },
        },
      });

      return { ok: true };
    }
  );

  // ---- Received vibes ----
  fastify.get(
    '/vibes',
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const currentUserId = req.user.sub;

      const myProfile = await prisma.profile.findUnique({
        where: { userId: currentUserId },
      });

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
        .map((item) => {
          const theirProfile = item.fromUser.profile!;
          const distance = computeDistance(
            myProfile?.locationLat ?? null,
            myProfile?.locationLng ?? null,
            myProfile?.city ?? null,
            theirProfile.locationLat,
            theirProfile.locationLng,
            theirProfile.city
          );

          return mapProfileToDiscoverCard(
            {
              userId: item.fromUserId,
              displayName: theirProfile.displayName,
              age: theirProfile.age,
              bio: theirProfile.bio,
              interests: theirProfile.interests,
              lastActive: theirProfile.lastActive,
              voiceIntroUrl: theirProfile.voiceIntroUrl,
              voiceIntroDurationSec: theirProfile.voiceIntroDurationSec,
            },
            distance
          );
        });

      return { ok: true, vibes };
    }
  );

  // ---- Matching stats for the current user ----
  fastify.get(
    '/stats',
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const currentUserId = req.user.sub;

      const [mutualMatches, sentVibes, receivedVibes] = await Promise.all([
        prisma.vibe.count({
          where: {
            fromUserId: currentUserId,
            matchedAt: { not: null },
          },
        }),
        prisma.vibe.count({
          where: { fromUserId: currentUserId },
        }),
        prisma.vibe.count({
          where: { toUserId: currentUserId },
        }),
      ]);

      return {
        ok: true,
        stats: {
          mutualMatches,
          sentVibes,
          receivedVibes,
          pendingSent: sentVibes - mutualMatches,
        },
      };
    }
  );
};

export default matchingRoutes;
