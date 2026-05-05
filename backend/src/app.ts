import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import authRoutes from './modules/auth/routes.js';
import matchingRoutes from './modules/matching/routes.js';
import messagingRoutes from './modules/messaging/routes.js';
import paymentRoutes from './modules/payments/routes.js';
import profileRoutes from './modules/profiles/routes.js';
import roomsRoutes from './modules/rooms/routes.js';
import { redis } from './shared/cache/redis.js';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import { extractBearerToken, verifyAccessToken } from './shared/auth/jwt.js';
import { env } from './shared/config/env.js';
import { prisma } from './shared/db/prisma.js';
import { requestIdMiddleware } from './shared/middleware/request-id.js';
import { initSocketServer, closeSocketServer } from './shared/realtime/socket.js';

export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.nodeEnv === 'production' ? 'info' : 'debug',
    },
    bodyLimit: 1 * 1024 * 1024, // 1 MB — photos upload directly to Supabase Storage
    requestTimeout: 30_000,
  });

  app.register(helmet);
  app.register(cors, { origin: env.corsOrigin });
  app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: 60_000,
    redis,
    errorResponseBuilder: (_req, context) => ({
      ok: false,
      message: `Too many requests — try again in ${Math.ceil((context.ttl ?? 60_000) / 1000)}s.`,
    }),
  } satisfies RateLimitPluginOptions);

  app.addHook('onRequest', requestIdMiddleware);
  app.decorate('authenticate', async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({ ok: false, message: 'Unauthorized' });
      return;
    }

    try {
      request.user = verifyAccessToken(token);
    } catch {
      reply.code(401).send({ ok: false, message: 'Unauthorized' });
      return;
    }
  });

  app.get('/health', async () => {
    return {
      ok: true,
      service: 'MiXiT API',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
    };
  });

  app.register(authRoutes, { prefix: '/auth' });
  app.register(profileRoutes, { prefix: '/profiles' });
  app.register(matchingRoutes, { prefix: '/matching' });
  app.register(messagingRoutes, { prefix: '/messaging' });
  app.register(roomsRoutes, { prefix: '/rooms' });
  app.register(paymentRoutes, { prefix: '/payments' });
  app.register(async (instance) => {
    await initSocketServer(instance);
  });

  app.addHook('onClose', async () => {
    await closeSocketServer();
    await prisma.$disconnect().catch(() => {});
    if (redis.status !== 'end' && redis.status !== 'wait') {
      await redis.quit().catch(() => {});
    } else {
      redis.disconnect();
    }
  });

  return app;
}
