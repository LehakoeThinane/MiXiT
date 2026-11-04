import crypto from 'node:crypto';

import { Prisma, type User } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { env } from '../../shared/config/env.js';
import { logger } from '../../shared/utils/logger.js';
import { revokeAppleAuthorization, verifyAppleIdentityToken } from '../../shared/auth/apple.js';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../shared/auth/jwt.js';
import { invalidateProfileCache } from '../../shared/cache/profile-cache.js';
import { resolveReferrer } from '../../shared/referrals/referrals.js';
import { deleteUserStorage } from '../../shared/storage/supabase-storage.js';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type GoogleSignInBody = { idToken: string; acceptedTerms?: boolean; referralCode?: string };
type AppleSignInBody = { identityToken: string; acceptedTerms?: boolean; referralCode?: string };
type DeleteAccountBody = { appleAuthorizationCode?: string };
type UpdatePhoneBody = { phone: string };
type RefreshBody = { refreshToken: string };
type LogoutBody = { refreshToken: string };

const googleSignInSchema = {
  body: {
    type: 'object',
    required: ['idToken'],
    properties: {
      idToken: { type: 'string', minLength: 16 },
      acceptedTerms: { type: 'boolean' },
      referralCode: { type: 'string', maxLength: 16 },
    },
  },
} as const;

const appleSignInSchema = {
  body: {
    type: 'object',
    required: ['identityToken'],
    properties: {
      identityToken: { type: 'string', minLength: 16, maxLength: 4096 },
      acceptedTerms: { type: 'boolean' },
      referralCode: { type: 'string', maxLength: 16 },
    },
  },
} as const;

const deleteAccountSchema = {
  body: {
    type: 'object',
    properties: { appleAuthorizationCode: { type: 'string', minLength: 8, maxLength: 1024 } },
  },
} as const;

const phoneSchema = {
  body: {
    type: 'object',
    required: ['phone'],
    properties: { phone: { type: 'string', minLength: 8, maxLength: 20 } },
  },
} as const;

const refreshSchema = {
  body: {
    type: 'object',
    required: ['refreshToken'],
    properties: { refreshToken: { type: 'string', minLength: 16 } },
  },
} as const;

const logoutSchema = {
  body: {
    type: 'object',
    required: ['refreshToken'],
    properties: { refreshToken: { type: 'string', minLength: 16 } },
  },
} as const;

function normalizePhone(input: string) {
  let phone = input.replace(/\s+/g, '').trim();
  // Convert South African local format (0xx) to international (+27xx)
  if (/^0\d{9}$/.test(phone)) {
    phone = '+27' + phone.slice(1);
  }
  return phone;
}

function isValidPhone(phone: string) {
  return /^\+?[1-9]\d{7,14}$/.test(phone);
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// A single client verifies tokens against any configured audience — iOS/Android/Web
// each mint ID tokens with a different `aud` claim from the same Google Cloud project.
const googleClient = new OAuth2Client();

type ResolveUserResult =
  | { ok: true; user: User }
  | { ok: false; status: number; message: string };

/**
 * Finds or creates the user for a verified Google/Apple identity. Accounts are
 * linked by verified email, so someone who signed up with Google on Android and
 * later uses Sign in with Apple on iOS (sharing their real email) lands on the
 * same account. New accounts require Terms/Privacy acceptance.
 */
async function resolveUser(input: Parameters<typeof findOrCreateUser>[0]): Promise<ResolveUserResult> {
  const result = await findOrCreateUser(input);
  if (result.ok && result.user.bannedAt) {
    return {
      ok: false,
      status: 403,
      message: `Your account has been suspended. Contact ${env.supportEmail} if you think this is a mistake.`,
    };
  }
  return result;
}

async function findOrCreateUser(input: {
  provider: 'google' | 'apple';
  providerId: string;
  email: string | null;
  acceptedTerms: boolean;
  referralCode?: string;
}): Promise<ResolveUserResult> {
  const { provider, providerId, email, acceptedTerms, referralCode } = input;
  const byProvider = provider === 'google' ? { googleId: providerId } : { appleId: providerId };
  const termsUpdate = acceptedTerms ? { termsAcceptedAt: new Date() } : {};

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const existing = await prisma.user.findUnique({ where: byProvider });
      if (existing) {
        const data: Prisma.UserUpdateInput = {};
        if (email && email !== existing.email) data.email = email;
        if (acceptedTerms && !existing.termsAcceptedAt) data.termsAcceptedAt = new Date();
        if (Object.keys(data).length === 0) return { ok: true, user: existing };
        try {
          return { ok: true, user: await prisma.user.update({ where: { id: existing.id }, data }) };
        } catch (error) {
          // Email now belongs to another account — keep the old one rather than failing sign-in.
          if (isUniqueConstraintError(error)) return { ok: true, user: existing };
          throw error;
        }
      }

      if (!email) {
        return {
          ok: false,
          status: 400,
          message: 'We could not get an email address from your sign-in. Please try again and share your email.',
        };
      }

      const byEmail = await prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        const linkedId = provider === 'google' ? byEmail.googleId : byEmail.appleId;
        if (linkedId && linkedId !== providerId) {
          return { ok: false, status: 409, message: 'Email already in use by another account' };
        }
        const user = await prisma.user.update({
          where: { id: byEmail.id },
          data: { ...byProvider, ...(byEmail.termsAcceptedAt ? {} : termsUpdate) },
        });
        return { ok: true, user };
      }

      if (!acceptedTerms) {
        return { ok: false, status: 400, message: 'Please accept the Terms of Use and Privacy Policy to continue.' };
      }

      const referredById = await resolveReferrer(referralCode);
      const user = await prisma.user.create({
        data: { ...byProvider, email, ...termsUpdate, ...(referredById ? { referredById } : {}) },
      });
      return { ok: true, user };
    } catch (error) {
      // Double-tap / concurrent retry raced us to create the row — loop once to read it back.
      if (isUniqueConstraintError(error) && attempt === 0) continue;
      throw error;
    }
  }
  return { ok: false, status: 409, message: 'Could not complete sign-in, please try again' };
}

async function issueTokens(userId: string, email: string, req: FastifyRequest) {
  const accessToken = signAccessToken(userId, email);
  const refreshToken = signRefreshToken(userId);

  await prisma.refreshSession.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      userAgent: req.headers['user-agent'] ?? null,
      ipAddress: req.ip ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });

  return { accessToken, refreshToken, tokenType: 'bearer', expiresIn: '3600' };
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: GoogleSignInBody }>(
    '/google',
    {
      schema: googleSignInSchema,
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      if (env.googleClientIds.length === 0) {
        return reply.code(501).send({ ok: false, message: 'Google Sign-In is not configured' });
      }

      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: req.body.idToken,
          audience: env.googleClientIds,
        });
        payload = ticket.getPayload();
      } catch {
        return reply.code(401).send({ ok: false, message: 'Invalid Google sign-in' });
      }

      if (!payload?.sub || !payload.email || !payload.email_verified) {
        return reply.code(401).send({ ok: false, message: 'Invalid Google sign-in' });
      }

      const result = await resolveUser({
        provider: 'google',
        providerId: payload.sub,
        email: payload.email,
        acceptedTerms: req.body.acceptedTerms === true,
        referralCode: req.body.referralCode,
      });
      if (!result.ok) return reply.code(result.status).send({ ok: false, message: result.message });

      const user = result.user;
      logger.info('User signed in via Google', { userId: user.id });

      return {
        ok: true,
        user: { id: user.id, email: user.email, phone: user.phone },
        tokens: await issueTokens(user.id, user.email, req),
      };
    }
  );

  // ---- Sign in with Apple (required on iOS alongside Google — guideline 4.8) ----
  fastify.post<{ Body: AppleSignInBody }>(
    '/apple',
    {
      schema: appleSignInSchema,
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      let identity;
      try {
        identity = await verifyAppleIdentityToken(req.body.identityToken);
      } catch (error) {
        req.log.warn({ err: error }, 'Apple identity token rejected');
        return reply.code(401).send({ ok: false, message: 'Invalid Apple sign-in' });
      }

      const result = await resolveUser({
        provider: 'apple',
        providerId: identity.sub,
        // Apple relay addresses (@privaterelay.appleid.com) are verified too.
        email: identity.email && identity.emailVerified ? identity.email : null,
        acceptedTerms: req.body.acceptedTerms === true,
        referralCode: req.body.referralCode,
      });
      if (!result.ok) return reply.code(result.status).send({ ok: false, message: result.message });

      const user = result.user;
      logger.info('User signed in via Apple', { userId: user.id });

      return {
        ok: true,
        user: { id: user.id, email: user.email, phone: user.phone },
        tokens: await issueTokens(user.id, user.email, req),
      };
    }
  );

  // ---- App-review demo account (disabled unless REVIEW_ACCOUNT_* are set) ----
  // Store reviewers can't be expected to use a personal Google/Apple account, and
  // both stores require working sign-in details for apps with a login.
  fastify.post<{ Body: { email: string; password: string } }>(
    '/review',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', minLength: 3, maxLength: 200 },
            password: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      if (!env.reviewAccountEmail || !env.reviewAccountPassword) {
        return reply.code(404).send({ ok: false, message: 'Not found' });
      }
      const emailOk = req.body.email.trim().toLowerCase() === env.reviewAccountEmail;
      const given = Buffer.from(req.body.password);
      const expected = Buffer.from(env.reviewAccountPassword);
      const passwordOk = given.length === expected.length && crypto.timingSafeEqual(given, expected);
      if (!emailOk || !passwordOk) {
        return reply.code(401).send({ ok: false, message: 'Incorrect email or password' });
      }

      const user = await prisma.user.upsert({
        where: { email: env.reviewAccountEmail },
        update: {},
        create: { email: env.reviewAccountEmail, termsAcceptedAt: new Date() },
      });
      if (user.bannedAt) return reply.code(403).send({ ok: false, message: 'Account suspended' });

      logger.info('Review account signed in', { userId: user.id });
      return {
        ok: true,
        user: { id: user.id, email: user.email, phone: user.phone },
        tokens: await issueTokens(user.id, user.email, req),
      };
    }
  );

  // ---- Permanently delete the account and all associated data ----
  // App Store 5.1.1(v) / Google Play account-deletion policy. Every user-owned row
  // cascades from `users` (profile, messages, vibes, rooms, purchases, sessions,
  // blocks, reports); uploaded media is removed from storage first.
  fastify.delete<{ Body: DeleteAccountBody }>(
    '/me',
    {
      preHandler: [fastify.authenticate],
      schema: deleteAccountSchema,
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const userId = req.user.sub;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return reply.code(404).send({ ok: false, message: 'Account not found' });

      try {
        await deleteUserStorage(userId);
      } catch (error) {
        // Don't block deletion on storage hiccups — orphaned objects are unreachable
        // without the DB rows that reference them, but log so they can be swept.
        req.log.error({ err: error, userId }, 'Account deletion: storage cleanup failed');
      }

      let appleRevoked = false;
      if (user.appleId && req.body?.appleAuthorizationCode) {
        appleRevoked = await revokeAppleAuthorization(req.body.appleAuthorizationCode);
      }

      await prisma.user.delete({ where: { id: userId } });
      await invalidateProfileCache(userId).catch(() => {});

      logger.info('Account deleted', { userId, appleRevoked });
      return { ok: true };
    }
  );

  fastify.put<{ Body: UpdatePhoneBody }>(
    '/phone',
    {
      preHandler: [fastify.authenticate],
      schema: phoneSchema,
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone);
      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }

      try {
        const user = await prisma.user.update({
          where: { id: req.user.sub },
          data: { phone },
        });
        return { ok: true, phone: user.phone };
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return reply.code(409).send({ ok: false, message: 'Phone already in use' });
        }
        throw error;
      }
    }
  );

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { profile: true },
    });
    return { ok: true, user };
  });

  fastify.post<{ Body: RefreshBody }>(
    '/refresh',
    { schema: refreshSchema, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      try {
        const payload = verifyRefreshToken(req.body.refreshToken);
        const tokenHash = hashToken(req.body.refreshToken);
        const session = await prisma.refreshSession.findUnique({ where: { tokenHash } });

        if (!session) {
          return reply.code(401).send({ ok: false, message: 'Refresh token expired' });
        }

        if (session.revokedAt) {
          // This token was already rotated away by an earlier /refresh call — someone is
          // replaying a stale refresh token (device sync bug, or theft). Treat it as a
          // compromise signal: kill every other active session for this user so a stolen
          // token can't keep refreshing itself indefinitely.
          const revoked = await prisma.refreshSession.updateMany({
            where: { userId: session.userId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          logger.warn('Refresh token reuse detected — session family revoked', {
            userId: session.userId,
            sessionsRevoked: revoked.count,
          });
          return reply.code(401).send({ ok: false, message: 'Refresh token expired' });
        }

        if (session.expiresAt < new Date()) {
          return reply.code(401).send({ ok: false, message: 'Refresh token expired' });
        }

        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user || user.bannedAt) {
          return reply.code(401).send({ ok: false, message: 'User not found' });
        }

        const accessToken = signAccessToken(user.id, user.email);
        const refreshToken = signRefreshToken(user.id);
        const newSession = await prisma.refreshSession.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(refreshToken),
            userAgent: req.headers['user-agent'] ?? null,
            ipAddress: req.ip ?? null,
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
          },
        });
        await prisma.refreshSession.update({
          where: { id: session.id },
          data: { revokedAt: new Date(), replacedById: newSession.id },
        });

        return {
          ok: true,
          user: { id: user.id, email: user.email, phone: user.phone },
          tokens: { accessToken, refreshToken },
        };
      } catch {
        return reply.code(401).send({ ok: false, message: 'Refresh token expired' });
      }
    }
  );

  fastify.post<{ Body: LogoutBody }>(
    '/logout',
    { schema: logoutSchema },
    async (req) => {
      const tokenHash = hashToken(req.body.refreshToken);
      await prisma.refreshSession.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { ok: true };
    }
  );
};

export default authRoutes;
