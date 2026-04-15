import type { FastifyPluginAsync } from 'fastify';
import { randomInt } from 'node:crypto';

import { ensureRedisConnection, redis } from '../../shared/cache/redis.js';
import { env } from '../../shared/config/env.js';
import { prisma } from '../../shared/db/prisma.js';
import { logger } from '../../shared/utils/logger.js';
import { getSmsSender } from './sms-provider.js';
import { hashToken, issueTokenPair, rotateRefreshToken } from './token-service.js';

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

type LogoutBody = {
  refreshToken: string;
};

function normalizePhone(input: string) {
  return input.replace(/\s+/g, '').trim();
}

function isValidPhone(phone: string) {
  return /^\+?[1-9]\d{7,14}$/.test(phone);
}

function otpKey(phone: string) {
  return `otp:code:${phone}`;
}

function otpRateKey(phone: string) {
  return `otp:rate:${phone}`;
}

function otpCooldownKey(phone: string) {
  return `otp:cooldown:${phone}`;
}

function otpAttemptsKey(phone: string) {
  return `otp:attempts:${phone}`;
}

function generateOtp() {
  return randomInt(100000, 1000000).toString();
}

function resolveUserAgent(input: string | string[] | undefined) {
  if (Array.isArray(input)) return input[0] ?? null;
  return input ?? null;
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

const logoutSchema = {
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
      let smsSender: ReturnType<typeof getSmsSender>;
      try {
        smsSender = getSmsSender();
      } catch (error) {
        logger.error('SMS sender setup failed', error);
        return reply.code(500).send({ ok: false, message: 'SMS provider is not configured' });
      }

      const phone = normalizePhone(req.body.phone);
      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }
      const cooldownKey = otpCooldownKey(phone);
      const cooldownRemaining = await redis.ttl(cooldownKey);
      if (cooldownRemaining > 0) {
        return reply.code(429).send({
          ok: false,
          message: `Please wait ${cooldownRemaining}s before requesting another code.`,
        });
      }

      const rateKey = otpRateKey(phone);
      const requestCount = await redis.incr(rateKey);
      if (requestCount === 1) {
        await redis.expire(rateKey, env.otpRequestWindowSeconds);
      }
      if (requestCount > env.otpMaxRequestsPerWindow) {
        return reply.code(429).send({ ok: false, message: 'Too many OTP requests. Try again soon.' });
      }

      const code = generateOtp();
      await redis.setex(otpKey(phone), env.otpTtlSeconds, code);
      await redis.del(otpAttemptsKey(phone));
      await redis.setex(cooldownKey, env.otpResendCooldownSeconds, '1');

      try {
        await smsSender.sendOtp(phone, code);
      } catch (error) {
        await redis.del(otpKey(phone));
        await redis.del(cooldownKey);
        logger.error('Failed to send OTP', error);
        return reply.code(502).send({ ok: false, message: 'Failed to send OTP. Please try again.' });
      }

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
      if (!stored) {
        return reply.code(401).send({ ok: false, message: 'Invalid or expired OTP' });
      }

      const attemptsKey = otpAttemptsKey(phone);
      const attemptCount = await redis.incr(attemptsKey);
      if (attemptCount === 1) {
        await redis.expire(attemptsKey, env.otpTtlSeconds);
      }
      if (attemptCount > env.otpMaxVerifyAttempts) {
        await redis.del(otpKey(phone));
        await redis.del(attemptsKey);
        await redis.del(otpCooldownKey(phone));
        return reply.code(429).send({ ok: false, message: 'Too many attempts. Request a new OTP.' });
      }

      if (stored !== code) {
        return reply.code(401).send({ ok: false, message: 'Invalid or expired OTP' });
      }

      await redis.del(otpKey(phone));
      await redis.del(attemptsKey);
      await redis.del(otpCooldownKey(phone));

      const user = await prisma.user.upsert({
        where: { phone },
        update: {},
        create: { phone },
      });

      const tokens = await issueTokenPair(reply, user, {
        userAgent: resolveUserAgent(req.headers['user-agent']),
        ipAddress: req.ip ?? null,
      });

      return {
        ok: true,
        user: {
          id: user.id,
          phone: user.phone,
        },
        tokens,
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
          sid?: string;
        }>(req.body.refreshToken);

        if (payload.type !== 'refresh' || !payload.sid) {
          return reply.code(401).send({ ok: false, message: 'Invalid refresh token' });
        }

        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) {
          return reply.code(401).send({ ok: false, message: 'User not found' });
        }

        const tokens = await rotateRefreshToken(reply, user, payload.sid, req.body.refreshToken, {
          userAgent: resolveUserAgent(req.headers['user-agent']),
          ipAddress: req.ip ?? null,
        });

        return {
          ok: true,
          user: {
            id: user.id,
            phone: user.phone,
          },
          tokens,
        };
      } catch {
        return reply.code(401).send({ ok: false, message: 'Refresh token expired' });
      }
    }
  );

  fastify.post<{ Body: LogoutBody }>(
    '/logout',
    { schema: logoutSchema },
    async (req, reply) => {
      try {
        const payload = await fastify.jwt.verify<{
          sub: string;
          type: 'access' | 'refresh';
          sid?: string;
        }>(req.body.refreshToken);

        if (payload.type !== 'refresh' || !payload.sid) {
          return reply.code(401).send({ ok: false, message: 'Invalid refresh token' });
        }

        await prisma.refreshSession.updateMany({
          where: {
            id: payload.sid,
            userId: payload.sub,
            tokenHash: hashToken(req.body.refreshToken),
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });

        return { ok: true };
      } catch {
        return reply.code(401).send({ ok: false, message: 'Invalid refresh token' });
      }
    }
  );
};

export default authRoutes;
