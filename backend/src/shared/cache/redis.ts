import { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Use configured URL or fall back to localhost (fails gracefully if not running)
const REDIS_URL = env.redisUrl || 'redis://127.0.0.1:6379';

export const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  connectTimeout: 5_000,
  commandTimeout: 3_000,
  enableOfflineQueue: false,
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
      logger.warn('Redis unavailable — caching/presence disabled', {
        error: (error as Error).message,
        url: env.redisUrl || '(not configured)',
      });
      throw new Error('Cache service unavailable');
    });

  return connectionPromise;
}

redis.on('error', (error) => {
  // Always listen to prevent Node.js from throwing unhandled error events
  if (state === 'connected') {
    state = 'failed';
    logger.warn('Redis connection lost', { error: error.message });
  }
});

redis.on('ready', () => {
  state = 'connected';
  logger.info('Redis ready');
});
