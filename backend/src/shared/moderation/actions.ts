import { env } from '../config/env.js';
import { invalidateProfileCache } from '../cache/profile-cache.js';
import { prisma } from '../db/prisma.js';
import { getSocketServer } from '../realtime/socket.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Banned-user check — used by the auth guard and socket handshake. Access tokens
// live up to an hour, so a ban must also be enforced per request. Banned users
// are rare, so the whole set is cached in memory and refreshed every minute.
// ---------------------------------------------------------------------------

const BANNED_REFRESH_MS = 60_000;
let bannedIds = new Set<string>();
let bannedFetchedAt = 0;
let bannedRefresh: Promise<void> | null = null;

async function refreshBannedIds() {
  const rows = await prisma.user.findMany({ where: { bannedAt: { not: null } }, select: { id: true } });
  bannedIds = new Set(rows.map((row) => row.id));
  bannedFetchedAt = Date.now();
}

export async function isUserBanned(userId: string): Promise<boolean> {
  if (Date.now() - bannedFetchedAt > BANNED_REFRESH_MS) {
    bannedRefresh ??= refreshBannedIds()
      .catch((error) => logger.warn('Banned-user refresh failed', { error: String(error) }))
      .finally(() => {
        bannedRefresh = null;
      });
    // Only block on the very first load; afterwards serve the slightly stale set.
    if (bannedFetchedAt === 0) await bannedRefresh;
  }
  return bannedIds.has(userId);
}

// ---------------------------------------------------------------------------
// Moderator alerts — Slack- and Discord-compatible incoming webhook.
// ---------------------------------------------------------------------------

export async function notifyModerators(text: string): Promise<void> {
  logger.info('Moderation alert', { text });
  if (!env.moderationWebhookUrl) return;
  try {
    await fetch(env.moderationWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
    });
  } catch (error) {
    logger.warn('Moderation webhook failed', { error: String(error) });
  }
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

/** Suspends a user: blocks sign-in, ends sessions, removes their public content. */
export async function banUser(userId: string, reason: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { bannedAt: new Date() } }),
    prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.roomMessage.deleteMany({ where: { userId } }),
    prisma.profile.updateMany({ where: { userId }, data: { pushToken: null } }),
  ]);
  bannedIds.add(userId);
  await invalidateProfileCache(userId).catch(() => undefined);
  getSocketServer()?.in(`user:${userId}`).disconnectSockets(true);
  logger.warn('User banned', { userId, reason });
}

export async function unbanUser(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { bannedAt: null, heldAt: null } });
  bannedIds.delete(userId);
  await invalidateProfileCache(userId).catch(() => undefined);
}

/** Hides a user from Discover, profile views and rooms until a moderator reviews them. */
export async function holdUser(userId: string): Promise<void> {
  await prisma.user.updateMany({ where: { id: userId, heldAt: null }, data: { heldAt: new Date() } });
}

export async function releaseHold(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { heldAt: null } });
}

const AUTO_HOLD_DISTINCT_REPORTERS = 3;
const AUTO_HOLD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Automatic safety hold so serious reports take effect before a human gets to
 * them: any "underage" report, or open reports from several different people.
 */
export async function applyAutoHold(reportedId: string, reason: string): Promise<boolean> {
  let shouldHold = reason === 'underage';
  if (!shouldHold) {
    const reporters = await prisma.report.findMany({
      where: {
        reportedId,
        status: 'open',
        createdAt: { gte: new Date(Date.now() - AUTO_HOLD_WINDOW_MS) },
      },
      distinct: ['reporterId'],
      select: { reporterId: true },
    });
    shouldHold = reporters.length >= AUTO_HOLD_DISTINCT_REPORTERS;
  }
  if (shouldHold) await holdUser(reportedId);
  return shouldHold;
}

/** Prisma filter for users whose content may be shown to others. */
export const visibleUserFilter = { bannedAt: null, heldAt: null } as const;
