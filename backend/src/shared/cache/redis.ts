import { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});

let hasConnected = false;

export async function ensureRedisConnection() {
  if (hasConnected) return;

  await redis.connect();
  hasConnected = true;
  logger.info('Redis connected');
}
