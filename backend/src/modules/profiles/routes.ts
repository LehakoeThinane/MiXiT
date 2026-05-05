import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { getProfileCache, invalidateProfileCache, setProfileCache } from '../../shared/cache/profile-cache.js';
import { createSignedUploadUrl } from '../../shared/storage/supabase-storage.js';

type UpsertProfileBody = {
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'homesexual';
  bio?: string;
  city?: string;
  locationLat?: number;
  locationLng?: number;
  interests?: string[];
  intents?: string[];
  traits?: string[];
  photos?: string[];
  showPhone?: boolean;
  showLastSeen?: boolean;
  voiceIntroUrl?: string;
  voiceIntroDurationSec?: number;
};

const profileSchema = {
  body: {
    type: 'object',
    required: ['displayName', 'age', 'gender'],
    properties: {
      displayName: { type: 'string', minLength: 2, maxLength: 30 },
      age: { type: 'integer', minimum: 18, maximum: 99 },
      gender: { type: 'string', enum: ['male', 'female', 'homesexual'] },
      bio: { type: 'string', maxLength: 300 },
      city: { type: 'string', maxLength: 120 },
      locationLat: { type: 'number', minimum: -90, maximum: 90 },
      locationLng: { type: 'number', minimum: -180, maximum: 180 },
      interests: {
        type: 'array',
        items: { type: 'string', minLength: 2, maxLength: 40 },
        minItems: 1,
        maxItems: 12,
      },
      intents: {
        type: 'array',
        items: { type: 'string', minLength: 2, maxLength: 40 },
        maxItems: 4,
      },
      traits: {
        type: 'array',
        items: { type: 'string', minLength: 2, maxLength: 120 },
        maxItems: 5,
      },
      photos: {
        type: 'array',
        items: { type: 'string', minLength: 6, maxLength: 500 },
        maxItems: 3,
      },
      showPhone: { type: 'boolean' },
      showLastSeen: { type: 'boolean' },
      voiceIntroUrl: { type: 'string', minLength: 6, maxLength: 2048 },
      voiceIntroDurationSec: { type: 'integer', minimum: 15, maximum: 30 },
    },
  },
} as const;

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const cached = await getProfileCache(req.user.sub);
    if (cached) return cached;

    const [profile, roomsParticipated, user] = await Promise.all([
      prisma.profile.findUnique({
        where: { userId: req.user.sub },
      }),
      prisma.roomMembership.count({
        where: { userId: req.user.sub },
      }),
      prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { createdAt: true },
      }),
    ]);

    if (!profile) {
      return reply.code(404).send({ ok: false, message: 'Profile not found' });
    }

    const result = {
      ok: true,
      profile,
      stats: {
        joinedAt: user?.createdAt ?? null,
        roomsParticipated,
      },
    };
    await setProfileCache(req.user.sub, result);
    return result;
  });

  fastify.put<{ Body: UpsertProfileBody }>(
    '/me',
    {
      preHandler: [fastify.authenticate],
      schema: profileSchema,
    },
    async (req, reply) => {
      if ((req.body.voiceIntroUrl && !req.body.voiceIntroDurationSec) || (!req.body.voiceIntroUrl && req.body.voiceIntroDurationSec)) {
        return reply.code(400).send({
          ok: false,
          message: 'Voice intro URL and duration must be provided together',
        });
      }

      const profile = await prisma.profile.upsert({
        where: { userId: req.user.sub },
        update: {
          displayName: req.body.displayName,
          age: req.body.age,
          gender: req.body.gender,
          bio: req.body.bio,
          city: req.body.city ?? null,
          locationLat: req.body.locationLat ?? null,
          locationLng: req.body.locationLng ?? null,
          interests: req.body.interests,
          intents: req.body.intents,
          traits: req.body.traits,
          photos: req.body.photos,
          showPhone: req.body.showPhone,
          showLastSeen: req.body.showLastSeen,
          voiceIntroUrl: req.body.voiceIntroUrl ?? null,
          voiceIntroDurationSec: req.body.voiceIntroDurationSec ?? null,
          completedAt: new Date(),
          lastActive: new Date(),
        },
        create: {
          userId: req.user.sub,
          displayName: req.body.displayName,
          age: req.body.age,
          gender: req.body.gender,
          bio: req.body.bio,
          city: req.body.city ?? null,
          locationLat: req.body.locationLat ?? null,
          locationLng: req.body.locationLng ?? null,
          interests: req.body.interests,
          intents: req.body.intents,
          traits: req.body.traits,
          photos: req.body.photos,
          showPhone: req.body.showPhone ?? true,
          showLastSeen: req.body.showLastSeen ?? true,
          voiceIntroUrl: req.body.voiceIntroUrl ?? null,
          voiceIntroDurationSec: req.body.voiceIntroDurationSec ?? null,
          completedAt: new Date(),
          lastActive: new Date(),
        },
      });

      const [roomsParticipated, user] = await Promise.all([
        prisma.roomMembership.count({
          where: { userId: req.user.sub },
        }),
        prisma.user.findUnique({
          where: { id: req.user.sub },
          select: { createdAt: true },
        }),
      ]);

      await invalidateProfileCache(req.user.sub);

      return {
        ok: true,
        profile,
        stats: {
          joinedAt: user?.createdAt ?? null,
          roomsParticipated,
        },
      };
    }
  );
  fastify.put(
    '/me/push-token',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (req) => {
      const { token } = req.body as { token: string };
      await prisma.profile.updateMany({
        where: { userId: req.user.sub },
        data: { pushToken: token },
      });
      return { ok: true };
    }
  );

  fastify.post(
    '/me/photo',
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['filename', 'mimeType'],
          properties: {
            filename: { type: 'string', minLength: 1, maxLength: 255 },
            mimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'] },
            size: { type: 'integer', minimum: 1, maximum: 5242880 },
          },
        },
      },
    },
    async (req, reply) => {
      const { filename, mimeType } = req.body as { filename: string; mimeType: string; size?: number };

      try {
        const { signedUrl, publicUrl } = await createSignedUploadUrl(req.user.sub, filename);
        return { ok: true, signedUrl, publicUrl };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to prepare photo upload';
        return reply.code(500).send({ ok: false, message });
      }
    }
  );
};

export default profileRoutes;
