import bcrypt from 'bcryptjs';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { logger } from '../../shared/utils/logger.js';
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../../shared/auth/jwt.js';

const BCRYPT_ROUNDS = 10;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type RegisterBody = { phone: string; password: string };
type LoginBody = { phone: string; password: string };
type RefreshBody = { refreshToken: string };
type LogoutBody = { refreshToken: string };

const phonePasswordSchema = {
  body: {
    type: 'object',
    required: ['phone', 'password'],
    properties: {
      phone: { type: 'string', minLength: 8, maxLength: 20 },
      password: { type: 'string', minLength: 6, maxLength: 100 },
    },
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

async function issueTokens(userId: string, phone: string, req: FastifyRequest) {
  const accessToken = signAccessToken(userId, phone);
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
  fastify.post<{ Body: RegisterBody }>(
    '/register',
    { schema: phonePasswordSchema, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone);
      const { password } = req.body;

      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const existing = await prisma.user.findUnique({ where: { phone } });

      if (existing?.passwordHash) {
        return reply.code(409).send({ ok: false, message: 'Phone already registered — sign in instead' });
      }

      const user = existing
        ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } })
        : await prisma.user.create({ data: { phone, passwordHash } });

      logger.info('User registered', { userId: user.id });

      return {
        ok: true,
        user: { id: user.id, phone: user.phone },
        tokens: await issueTokens(user.id, user.phone, req),
      };
    }
  );

  fastify.post<{ Body: LoginBody }>(
    '/login',
    { schema: phonePasswordSchema, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone);
      const { password } = req.body;

      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }

      const user = await prisma.user.findUnique({ where: { phone } });
      const isValid = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;

      if (!user || !isValid) {
        return reply.code(401).send({ ok: false, message: 'Invalid phone or password' });
      }

      logger.info('User logged in', { userId: user.id });

      return {
        ok: true,
        user: { id: user.id, phone: user.phone },
        tokens: await issueTokens(user.id, user.phone, req),
      };
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

        if (!session || session.revokedAt || session.expiresAt < new Date()) {
          return reply.code(401).send({ ok: false, message: 'Refresh token expired' });
        }

        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) {
          return reply.code(401).send({ ok: false, message: 'User not found' });
        }

        const accessToken = signAccessToken(user.id, user.phone);
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
          user: { id: user.id, phone: user.phone },
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
