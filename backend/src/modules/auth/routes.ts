import { Prisma } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { env } from '../../shared/config/env.js';
import { logger } from '../../shared/utils/logger.js';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../shared/auth/jwt.js';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type GoogleSignInBody = { idToken: string };
type UpdatePhoneBody = { phone: string };
type RefreshBody = { refreshToken: string };
type LogoutBody = { refreshToken: string };

const googleSignInSchema = {
  body: {
    type: 'object',
    required: ['idToken'],
    properties: { idToken: { type: 'string', minLength: 16 } },
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

      const googleId = payload.sub;
      const email = payload.email;

      let user;
      try {
        // Upsert, not find-then-create — a double-tap or client retry racing two
        // concurrent requests would otherwise hit an unhandled unique-constraint 500.
        user = await prisma.user.upsert({
          where: { googleId },
          update: { email },
          create: { googleId, email },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return reply.code(409).send({ ok: false, message: 'Email already in use by another account' });
        }
        throw error;
      }

      logger.info('User signed in via Google', { userId: user.id });

      return {
        ok: true,
        user: { id: user.id, email: user.email, phone: user.phone },
        tokens: await issueTokens(user.id, user.email, req),
      };
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
        if (!user) {
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
