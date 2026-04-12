import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';

import authRoutes from './modules/auth/routes.js';
import matchingRoutes from './modules/matching/routes.js';
import messagingRoutes from './modules/messaging/routes.js';
import paymentRoutes from './modules/payments/routes.js';
import profileRoutes from './modules/profiles/routes.js';
import { redis } from './shared/cache/redis.js';
import { env } from './shared/config/env.js';
import { prisma } from './shared/db/prisma.js';
import { requestIdMiddleware } from './shared/middleware/request-id.js';

export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.nodeEnv === 'production' ? 'info' : 'debug',
    },
  });

  app.register(helmet);
  app.register(cors, { origin: env.corsOrigin });
  app.register(jwt, { secret: env.jwtSecret });

  app.addHook('onRequest', requestIdMiddleware);
  app.decorate('authenticate', async (request) => {
    await request.jwtVerify();
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
  app.register(paymentRoutes, { prefix: '/payments' });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
    if (redis.status !== 'end') {
      await redis.quit();
    }
  });

  return app;
}
