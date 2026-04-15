import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';

type UpsertProfileBody = {
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'homesexual';
  bio?: string;
  city?: string;
  locationLat?: number;
  locationLng?: number;
  interests?: string[];
  photos?: string[];
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
        minItems: 3,
        maxItems: 12,
      },
      photos: {
        type: 'array',
        items: { type: 'string', minLength: 6, maxLength: 2048 },
        maxItems: 3,
      },
      voiceIntroUrl: { type: 'string', minLength: 6, maxLength: 2048 },
      voiceIntroDurationSec: { type: 'integer', minimum: 15, maximum: 30 },
    },
  },
} as const;

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (req, reply) => {
    const profile = await prisma.profile.findUnique({
      where: { userId: req.user.sub },
    });

    if (!profile) {
      return reply.code(404).send({ ok: false, message: 'Profile not found' });
    }

    return { ok: true, profile };
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
          photos: req.body.photos,
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
          photos: req.body.photos,
          voiceIntroUrl: req.body.voiceIntroUrl ?? null,
          voiceIntroDurationSec: req.body.voiceIntroDurationSec ?? null,
          completedAt: new Date(),
          lastActive: new Date(),
        },
      });

      return { ok: true, profile };
    }
  );
};

export default profileRoutes;
