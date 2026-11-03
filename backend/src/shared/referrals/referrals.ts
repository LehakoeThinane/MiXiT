import crypto from 'node:crypto';

import { BOOST_DURATION_MS, ensureSeedProducts } from '../../modules/payments/routes.js';
import { prisma } from '../db/prisma.js';
import { sendPushNotification } from '../push/expo-push.js';
import { logger } from '../utils/logger.js';

// Invite codes: 8 characters, no look-alikes (0/O, 1/I/L), easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

// Anti-abuse: an inviter earns at most this many reward Boosts per rolling window.
// The person who was invited always gets theirs.
export const MAX_INVITER_REWARDS = 10;
const INVITER_REWARD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

function randomCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z0-9]{8}$/.test(code) ? code : null;
}

/** Returns the user's invite code, creating one on first use. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  if (user?.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const updated = await prisma.user
      .updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: code } })
      .catch(() => null); // unique collision — try another code
    if (updated?.count === 1) return code;
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (current?.referralCode) return current.referralCode; // set concurrently
  }
  throw new Error('Could not create an invite code');
}

/** Resolves an invite code to the inviter's id (never the new user themselves). */
export async function resolveReferrer(code: unknown, newUserId?: string): Promise<string | null> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  const inviter = await prisma.user.findUnique({
    where: { referralCode: normalized },
    select: { id: true, bannedAt: true },
  });
  if (!inviter || inviter.bannedAt || inviter.id === newUserId) return null;
  return inviter.id;
}

async function grantFreeBoost(userId: string, reference: string): Promise<boolean> {
  await ensureSeedProducts();
  const boost = await prisma.product.findUnique({ where: { slug: 'vibe-boost' } });
  if (!boost) return false;
  const merchantReference = `referral:${reference}`;
  const existing = await prisma.userPurchase.findUnique({ where: { merchantReference } });
  if (existing) return false;
  await prisma.userPurchase.create({
    data: {
      userId,
      productId: boost.id,
      status: 'active',
      merchantReference,
      amountInCents: 0,
      currency: boost.currency,
      expiresAt: new Date(Date.now() + BOOST_DURATION_MS),
    },
  });
  return true;
}

/**
 * Called when a user completes their profile for the first time. If they signed
 * up through an invite, both they and the inviter get a free 30-minute Vibe Boost
 * (once per invited user; inviter rewards capped per 30 days).
 */
export async function rewardReferralOnProfileComplete(userId: string): Promise<void> {
  try {
    const claimed = await prisma.user.updateMany({
      where: { id: userId, referredById: { not: null }, referralRewardedAt: null },
      data: { referralRewardedAt: new Date() },
    });
    if (claimed.count !== 1) return; // not referred, or already rewarded

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referredById: true, profile: { select: { displayName: true } } },
    });
    const inviterId = user?.referredById;
    if (!inviterId) return;

    await grantFreeBoost(userId, `${userId}:invitee`);

    const recentInviterRewards = await prisma.user.count({
      where: {
        referredById: inviterId,
        referralRewardedAt: { gte: new Date(Date.now() - INVITER_REWARD_WINDOW_MS) },
      },
    });
    if (recentInviterRewards > MAX_INVITER_REWARDS) {
      logger.info('Referral inviter reward capped', { inviterId });
      return;
    }

    const granted = await grantFreeBoost(inviterId, `${userId}:inviter`);
    if (granted) {
      const inviter = await prisma.profile.findUnique({ where: { userId: inviterId }, select: { pushToken: true } });
      await sendPushNotification(
        inviter?.pushToken,
        'Your invite worked 🎉',
        `${user?.profile?.displayName ?? 'Your friend'} joined MiXiT — enjoy a free 30-minute Vibe Boost!`,
        { type: 'referral' }
      );
    }
  } catch (error) {
    logger.warn('Referral reward failed', { userId, error: error instanceof Error ? error.message : String(error) });
  }
}
