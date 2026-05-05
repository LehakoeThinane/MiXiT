import { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const redis = new Redis(env.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  connectTimeout: 10_000,
  commandTimeout: 5_000,
});

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'failed';
let state: ConnectionState = 'idle';
let connectionPromise: Promise<void> | null = null;

export async function ensureRedisConnection() {
  if (state === 'connected') return;

  if (state === 'connecting' && connectionPromise) {
    return connectionPromise;
  }

  state = 'connecting';
  connectionPromise = redis
    .connect()
    .then(() => {
      state = 'connected';
      connectionPromise = null;
      logger.info('Redis connected');
    })
    .catch((error: unknown) => {
      state = 'failed';
      connectionPromise = null;
      logger.error('Redis connection failed', { error: (error as Error).message, url: env.redisUrl });
      throw new Error('Cache service unavailable');
    });

  return connectionPromise;
}

redis.on('error', (error) => {
  if (state === 'connected') {
    state = 'failed';
    logger.error('Redis connection lost', { error: error.message });
  }
});

redis.on('ready', () => {
  state = 'connected';
  logger.info('Redis ready');
});
