import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';

type UpsertProfileBody = {
  displayName: string;
  age: number;
  gender: 'male' | 'female' | 'non-binary';
  bio?: string;
};

const profileSchema = {
  body: {
    type: 'object',
    required: ['displayName', 'age', 'gender'],
    properties: {
      displayName: { type: 'string', minLength: 2, maxLength: 30 },
      age: { type: 'integer', minimum: 18, maximum: 99 },
      gender: { type: 'string', enum: ['male', 'female', 'non-binary'] },
      bio: { type: 'string', maxLength: 300 },
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
    async (req) => {
      const profile = await prisma.profile.upsert({
        where: { userId: req.user.sub },
        update: {
          displayName: req.body.displayName,
          age: req.body.age,
          gender: req.body.gender,
          bio: req.body.bio,
          lastActive: new Date(),
        },
        create: {
          userId: req.user.sub,
          displayName: req.body.displayName,
          age: req.body.age,
          gender: req.body.gender,
          bio: req.body.bio,
          lastActive: new Date(),
        },
      });

      return { ok: true, profile };
    }
  );
};

export default profileRoutes;
