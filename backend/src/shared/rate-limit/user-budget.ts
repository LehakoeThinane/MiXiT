import { redis } from '../cache/redis.js';
import { logger } from '../utils/logger.js';

/**
 * Per-user fixed-window budgets shared by every path that spends them — e.g. the
 * DM budget is spent by both POST /messaging/messages and the socket
 * `message:send` event, so the two paths together get one allowance.
 *
 * Counts live in Redis (shared across instances) when it is reachable. If Redis
 * is down the limiter falls back to a per-process in-memory window instead of
 * failing open, so abuse protection never drops to zero.
 */

export type Budget = { name: string; limit: number; windowMs: number };

export const BUDGETS = {
  /** Direct messages sent, REST + socket combined. */
  directMessages: { name: 'dm', limit: 60, windowMs: 60_000 },
  /** typing:start / typing:stop events. */
  typing: { name: 'typing', limit: 30, windowMs: 10_000 },
} as const satisfies Record<string, Budget>;

/** Minimal slice of ioredis used here, so tests can supply a fake. */
export type CounterStore = {
  status: string;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
};

// INCR, and set the expiry only when the key is new — atomic in one round trip.
const INCR_WITH_TTL = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count`;

const memoryWindows = new Map<string, { count: number; resetAt: number }>();

function consumeInMemory(key: string, budget: Budget, now: number): boolean {
  const window = memoryWindows.get(key);
  if (!window || window.resetAt <= now) {
    memoryWindows.set(key, { count: 1, resetAt: now + budget.windowMs });
    if (memoryWindows.size > 20_000) {
      for (const [k, v] of memoryWindows) if (v.resetAt <= now) memoryWindows.delete(k);
    }
    return true;
  }
  window.count += 1;
  return window.count <= budget.limit;
}

let warnedFallback = false;

/** Spends one unit of `budget` for `userId`. Returns false once the window's limit is used up. */
export async function consumeUserBudget(
  budget: Budget,
  userId: string,
  options: { store?: CounterStore; now?: number } = {}
): Promise<boolean> {
  const store = options.store ?? redis;
  const now = options.now ?? Date.now();
  const windowStart = Math.floor(now / budget.windowMs) * budget.windowMs;
  const key = `budget:${budget.name}:${userId}:${windowStart}`;

  if (store.status === 'ready') {
    try {
      const count = Number(await store.eval(INCR_WITH_TTL, 1, key, budget.windowMs));
      return count <= budget.limit;
    } catch (error) {
      logger.warn('Rate-limit store error — using in-memory budget', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else if (!warnedFallback) {
    warnedFallback = true;
    logger.warn('Redis not ready — per-user rate limits are per-process (in-memory)');
  }
  return consumeInMemory(key, budget, now);
}

/** Test helper: forget in-memory windows. */
export function resetInMemoryBudgets() {
  memoryWindows.clear();
}
