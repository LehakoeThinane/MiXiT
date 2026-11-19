import { prisma } from '../db/prisma.js';

export async function getBlockedUserIds(userId: string): Promise<Set<string>> {
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });

  const ids = new Set<string>();
  for (const block of blocks) {
    ids.add(block.blockerId === userId ? block.blockedId : block.blockerId);
  }
  return ids;
}

export async function isBlockedPair(userA: string, userB: string): Promise<boolean> {
  const block = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: userA, blockedId: userB },
        { blockerId: userB, blockedId: userA },
      ],
    },
    select: { id: true },
  });
  return Boolean(block);
}

// ---------------------------------------------------------------------------
// Short-lived cache for hot paths (socket typing events fire constantly).
// Block/unblock routes call forgetBlockedPair so changes apply immediately on
// this instance; other instances see them within BLOCK_CACHE_MS.
// ---------------------------------------------------------------------------

const BLOCK_CACHE_MS = 30_000;
const blockCache = new Map<string, { blocked: boolean; expiresAt: number }>();
const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export async function isBlockedPairCached(userA: string, userB: string): Promise<boolean> {
  const key = pairKey(userA, userB);
  const now = Date.now();
  const cached = blockCache.get(key);
  if (cached && cached.expiresAt > now) return cached.blocked;

  const blocked = await isBlockedPair(userA, userB);
  blockCache.set(key, { blocked, expiresAt: now + BLOCK_CACHE_MS });
  if (blockCache.size > 50_000) {
    for (const [k, v] of blockCache) if (v.expiresAt <= now) blockCache.delete(k);
  }
  return blocked;
}

export function forgetBlockedPair(userA: string, userB: string) {
  blockCache.delete(pairKey(userA, userB));
}
