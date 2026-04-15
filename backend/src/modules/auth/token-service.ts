import { createHash, randomUUID } from 'node:crypto';

import type { FastifyReply } from 'fastify';

import { env } from '../../shared/config/env.js';
import { prisma } from '../../shared/db/prisma.js';

type AuthUser = {
  id: string;
  phone: string;
};

type SessionMeta = {
  userAgent?: string | null;
  ipAddress?: string | null;
};

const REFRESH_FALLBACK_MS = 30 * 24 * 60 * 60 * 1000;

function parseDurationToMs(input: string, fallbackMs: number) {
  const value = input.trim().toLowerCase();
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount)) return fallbackMs;

  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60 * 1000;
  if (unit === 'h') return amount * 60 * 60 * 1000;
  return amount * 24 * 60 * 60 * 1000;
}

function refreshExpiresAt() {
  return new Date(Date.now() + parseDurationToMs(env.jwtRefreshTtl, REFRESH_FALLBACK_MS));
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueTokenPair(
  reply: FastifyReply,
  user: AuthUser,
  meta: SessionMeta = {}
) {
  const sessionId = randomUUID();

  const accessToken = await reply.jwtSign(
    { sub: user.id, phone: user.phone, type: 'access' },
    { expiresIn: env.jwtAccessTtl }
  );

  const refreshToken = await reply.jwtSign(
    { sub: user.id, phone: user.phone, type: 'refresh', sid: sessionId },
    { expiresIn: env.jwtRefreshTtl }
  );

  await prisma.refreshSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt: refreshExpiresAt(),
    },
  });

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: env.jwtAccessTtl,
  };
}

export async function rotateRefreshToken(
  reply: FastifyReply,
  user: AuthUser,
  oldSessionId: string,
  oldRefreshToken: string,
  meta: SessionMeta = {}
) {
  const nextSessionId = randomUUID();

  const accessToken = await reply.jwtSign(
    { sub: user.id, phone: user.phone, type: 'access' },
    { expiresIn: env.jwtAccessTtl }
  );

  const refreshToken = await reply.jwtSign(
    { sub: user.id, phone: user.phone, type: 'refresh', sid: nextSessionId },
    { expiresIn: env.jwtRefreshTtl }
  );

  const now = new Date();
  const oldHash = hashToken(oldRefreshToken);

  await prisma.$transaction(async (tx) => {
    await tx.refreshSession.create({
      data: {
        id: nextSessionId,
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt: refreshExpiresAt(),
      },
    });

    const updated = await tx.refreshSession.updateMany({
      where: {
        id: oldSessionId,
        userId: user.id,
        tokenHash: oldHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        revokedAt: now,
        replacedById: nextSessionId,
      },
    });

    if (updated.count !== 1) {
      throw new Error('Refresh session is invalid or already rotated');
    }
  });

  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: env.jwtAccessTtl,
  };
}
