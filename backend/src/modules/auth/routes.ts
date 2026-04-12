import type { FastifyPluginAsync } from 'fastify';
import { randomInt } from 'node:crypto';

import { ensureRedisConnection, redis } from '../../shared/cache/redis.js';
import { env } from '../../shared/config/env.js';
import { prisma } from '../../shared/db/prisma.js';
import { logger } from '../../shared/utils/logger.js';

type RequestOtpBody = {
  phone: string;
};

type VerifyOtpBody = {
  phone: string;
  code: string;
};

type RefreshBody = {
  refreshToken: string;
};

function normalizePhone(input: string) {
  return input.replace(/\s+/g, '').trim();
}

function isValidPhone(phone: string) {
  return /^\+?[1-9]\d{7,14}$/.test(phone);
}

function otpKey(phone: string) {
  return `otp:${phone}`;
}

function otpRateKey(phone: string) {
  return `otp:rate:${phone}`;
}

function generateOtp() {
  return randomInt(100000, 1000000).toString();
}

const requestOtpSchema = {
  body: {
    type: 'object',
    required: ['phone'],
    properties: {
      phone: { type: 'string', minLength: 8, maxLength: 20 },
    },
  },
} as const;

const verifyOtpSchema = {
  body: {
    type: 'object',
    required: ['phone', 'code'],
    properties: {
      phone: { type: 'string', minLength: 8, maxLength: 20 },
      code: { type: 'string', minLength: 6, maxLength: 6 },
    },
  },
} as const;

const refreshSchema = {
  body: {
    type: 'object',
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string', minLength: 16 },
    },
  },
} as const;

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RequestOtpBody }>(
    '/request-otp',
    { schema: requestOtpSchema },
    async (req, reply) => {
      await ensureRedisConnection();

      const phone = normalizePhone(req.body.phone);
      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }

      const rateKey = otpRateKey(phone);
      const requestCount = await redis.incr(rateKey);
      if (requestCount === 1) {
        await redis.expire(rateKey, 60);
      }
      if (requestCount > 3) {
        return reply.code(429).send({ ok: false, message: 'Too many OTP requests. Try again soon.' });
      }

      const code = generateOtp();
      await redis.setex(otpKey(phone), 300, code);

      logger.info('OTP generated', { phone });

      return {
        ok: true,
        message: 'OTP sent',
        ...(env.nodeEnv !== 'production' ? { debugCode: code } : {}),
      };
    }
  );

  fastify.post<{ Body: VerifyOtpBody }>(
    '/verify-otp',
    { schema: verifyOtpSchema },
    async (req, reply) => {
      await ensureRedisConnection();

      const phone = normalizePhone(req.body.phone);
      const code = req.body.code.trim();

      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }

      const stored = await redis.get(otpKey(phone));
      if (!stored || stored !== code) {
        return reply.code(401).send({ ok: false, message: 'Invalid or expired OTP' });
      }

      await redis.del(otpKey(phone));

      const user = await prisma.user.upsert({
        where: { phone },
        update: {},
        create: { phone },
      });

      const accessToken = await reply.jwtSign(
        { sub: user.id, phone: user.phone, type: 'access' },
        { expiresIn: env.jwtAccessTtl }
      );
      const refreshToken = await reply.jwtSign(
        { sub: user.id, phone: user.phone, type: 'refresh' },
        { expiresIn: env.jwtRefreshTtl }
      );

      return {
        ok: true,
        user: {
          id: user.id,
          phone: user.phone,
        },
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer',
          expiresIn: env.jwtAccessTtl,
        },
      };
    }
  );

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      include: { profile: true },
    });

    return {
      ok: true,
      user,
    };
  });

  fastify.post<{ Body: RefreshBody }>(
    '/refresh',
    { schema: refreshSchema },
    async (req, reply) => {
      try {
        const payload = await fastify.jwt.verify<{
          sub: string;
          phone: string;
          type: 'access' | 'refresh';
        }>(req.body.refreshToken);

        if (payload.type !== 'refresh') {
          return reply.code(401).send({ ok: false, message: 'Invalid refresh token' });
        }

        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) {
          return reply.code(401).send({ ok: false, message: 'User not found' });
        }

        const accessToken = await reply.jwtSign(
          { sub: user.id, phone: user.phone, type: 'access' },
          { expiresIn: env.jwtAccessTtl }
        );
        const refreshToken = await reply.jwtSign(
          { sub: user.id, phone: user.phone, type: 'refresh' },
          { expiresIn: env.jwtRefreshTtl }
        );

        return {
          ok: true,
          user: {
            id: user.id,
            phone: user.phone,
          },
          tokens: {
            accessToken,
            refreshToken,
            tokenType: 'Bearer',
            expiresIn: env.jwtAccessTtl,
          },
        };
      } catch {
        return reply.code(401).send({ ok: false, message: 'Refresh token expired' });
      }
    }
  );
};

export default authRoutes;
