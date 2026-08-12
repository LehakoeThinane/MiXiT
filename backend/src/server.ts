import './instrument.js';

import * as Sentry from '@sentry/node';

import { buildApp } from './app.js';
import { ensureRedisConnection } from './shared/cache/redis.js';
import { env } from './shared/config/env.js';
import { prisma } from './shared/db/prisma.js';
import { ensureChatMediaBucket, ensureStorageBucket } from './shared/storage/supabase-storage.js';
import { logger } from './shared/utils/logger.js';

function maskUrl(value: string) {
  if (!value) return '(missing)';

  try {
    const url = new URL(value);
    const host = url.host || '(unknown-host)';
    const pathname = url.pathname && url.pathname !== '/' ? url.pathname : '';
    return `${url.protocol}//${host}${pathname}`;
  } catch {
    return '(invalid-url)';
  }
}

function maskSecret(value: string) {
  if (!value) return '(missing)';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

process.on('uncaughtException', (error) => {
  Sentry.captureException(error);
  logger.error('UNCAUGHT_EXCEPTION', { message: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason);
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('UNHANDLED_REJECTION', { message, stack });
  process.exit(1);
});

async function start() {
  const app = buildApp();

  try {
    logger.info('Boot config', {
      cwd: process.cwd(),
      nodeEnv: env.nodeEnv,
      host: env.host,
      port: env.port,
      corsOrigin: env.corsOrigin,
      databaseUrl: maskUrl(env.databaseUrl),
      redisUrl: maskUrl(env.redisUrl),
      supabaseUrl: env.supabaseUrl ? maskUrl(env.supabaseUrl) : '(not set)',
      supabaseAnonKey: env.supabaseAnonKey ? maskSecret(env.supabaseAnonKey) : '(not set)',
    });

    await prisma.$connect();
    logger.info('Database connection established');

    // Best-effort — rate limiting/caching fall back gracefully (skipOnError) if this
    // never connects, so a Redis outage shouldn't block boot.
    await ensureRedisConnection().catch((error: unknown) => {
      logger.warn('Redis connection failed at boot — rate limiting/caching degraded', {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    await app.listen({ host: env.host, port: env.port });
    logger.info(`API running on http://${env.host}:${env.port}`);

    ensureStorageBucket().catch((error: unknown) => {
      logger.warn('Storage bucket setup failed — photo uploads will not work', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    ensureChatMediaBucket().catch((error: unknown) => {
      logger.warn('Chat media bucket setup failed — voice/image messages will not work', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

void start();
