import { redis } from '../../shared/cache/redis.js';

type MemoryEntry = {
  value: string;
  expiresAt: number | null;
};

const memoryStore = new Map<string, MemoryEntry>();

function isExpired(entry: MemoryEntry) {
  return entry.expiresAt !== null && entry.expiresAt <= Date.now();
}

function readMemoryEntry(key: string) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (isExpired(entry)) {
    memoryStore.delete(key);
    return null;
  }
  return entry;
}

function writeMemoryValue(key: string, value: string, ttlSeconds: number) {
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

function expireMemoryValue(key: string, ttlSeconds: number) {
  const entry = readMemoryEntry(key);
  if (!entry) return 0;
  entry.expiresAt = Date.now() + ttlSeconds * 1000;
  memoryStore.set(key, entry);
  return 1;
}

export function isRedisReady() {
  return redis.status === 'ready';
}

export async function getValue(key: string) {
  if (isRedisReady()) {
    return redis.get(key);
  }

  return readMemoryEntry(key)?.value ?? null;
}

export async function setValueWithExpiry(key: string, ttlSeconds: number, value: string) {
  if (isRedisReady()) {
    await redis.setex(key, ttlSeconds, value);
    return;
  }

  writeMemoryValue(key, value, ttlSeconds);
}

export async function deleteValue(key: string) {
  if (isRedisReady()) {
    await redis.del(key);
    return;
  }

  memoryStore.delete(key);
}

export async function getTtl(key: string) {
  if (isRedisReady()) {
    return redis.ttl(key);
  }

  const entry = readMemoryEntry(key);
  if (!entry) return -2;
  if (entry.expiresAt === null) return -1;

  return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
}

export async function incrementValue(key: string) {
  if (isRedisReady()) {
    return redis.incr(key);
  }

  const entry = readMemoryEntry(key);
  const nextValue = entry ? Number(entry.value) + 1 : 1;
  memoryStore.set(key, {
    value: String(nextValue),
    expiresAt: entry?.expiresAt ?? null,
  });

  return nextValue;
}

export async function expireValue(key: string, ttlSeconds: number) {
  if (isRedisReady()) {
    return redis.expire(key, ttlSeconds);
  }

  return expireMemoryValue(key, ttlSeconds);
}
