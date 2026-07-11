import { ensureRedisConnection, redis } from './redis.js';
import { logger } from '../utils/logger.js';

const TTL_SEC = 60;
const key = (userId: string) => `profile:me:${userId}`;

export async function getProfileCache(userId: string): Promise<unknown | null> {
  try {
    await ensureRedisConnection();
    const raw = await redis.get(key(userId));
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export async function setProfileCache(userId: string, data: unknown): Promise<void> {
  try {
    await ensureRedisConnection();
    await redis.setex(key(userId), TTL_SEC, JSON.stringify(data));
  } catch (error) {
    logger.warn('Profile cache write failed', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function invalidateProfileCache(userId: string): Promise<void> {
  try {
    await ensureRedisConnection();
    await redis.del(key(userId));
  } catch {
    // non-fatal — cache expires naturally after TTL_SEC
  }
}
