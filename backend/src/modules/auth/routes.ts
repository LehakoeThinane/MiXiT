import { randomInt } from 'crypto';
import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { env } from '../../shared/config/env.js';
import { logger } from '../../shared/utils/logger.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../shared/auth/jwt.js';
import { getSmsSender } from './sms-provider.js';
import {
  deleteValue,
  expireValue,
  getTtl,
  getValue,
  incrementValue,
  setValueWithExpiry,
} from './otp-store.js';

type RequestOtpBody = { phone: string };
type VerifyOtpBody = { phone: string; code: string };
type RefreshBody = { refreshToken: string };
type LogoutBody = { refreshToken: string };

const requestOtpSchema = {
  body: {
    type: 'object',
    required: ['phone'],
    properties: { phone: { type: 'string', minLength: 8, maxLength: 20 } },
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
  return input.replace(/\s+/g, '').trim();
}

function isValidPhone(phone: string) {
  return /^\+?[1-9]\d{7,14}$/.test(phone);
}

function generateOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function otpCodeKey(phone: string) { return `otp:code:${phone}`; }
function otpAttemptsKey(phone: string) { return `otp:attempts:${phone}`; }
function otpCooldownKey(phone: string) { return `otp:cooldown:${phone}`; }

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RequestOtpBody }>(
    '/request-otp',
    { schema: requestOtpSchema, config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone);
      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }

      const cooldownTtl = await getTtl(otpCooldownKey(phone));
      if (cooldownTtl > 0) {
        return reply.code(429).send({
          ok: false,
          message: `Please wait ${cooldownTtl}s before requesting another code`,
        });
      }

      const code = generateOtpCode();

      await setValueWithExpiry(otpCodeKey(phone), env.otpTtlSeconds, code);
      await setValueWithExpiry(otpCooldownKey(phone), env.otpResendCooldownSeconds, '1');
      await deleteValue(otpAttemptsKey(phone));

      try {
        await getSmsSender().sendOtp(phone, code);
      } catch (error) {
        logger.error('SMS send failed', { phone, error });
        return reply.code(500).send({ ok: false, message: 'Failed to send OTP — please try again' });
      }

      logger.info('OTP sent', { phone });

      return {
        ok: true,
        message: 'OTP sent',
        ...(env.nodeEnv !== 'production' && { debugCode: code }),
      };
    }
  );

  fastify.post<{ Body: VerifyOtpBody }>(
    '/verify-otp',
    { schema: verifyOtpSchema, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone);
      const code = req.body.code.trim();

      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }

      const storedCode = await getValue(otpCodeKey(phone));
      if (!storedCode) {
        return reply.code(401).send({ ok: false, message: 'OTP expired or not found' });
      }

      const attemptsStr = await getValue(otpAttemptsKey(phone));
      const attempts = attemptsStr ? Number(attemptsStr) : 0;

      if (attempts >= env.otpMaxVerifyAttempts) {
        await deleteValue(otpCodeKey(phone));
        await deleteValue(otpAttemptsKey(phone));
        return reply.code(429).send({ ok: false, message: 'Too many attempts — request a new code' });
      }

      if (code !== storedCode) {
        const newCount = await incrementValue(otpAttemptsKey(phone));
        if (newCount === 1) {
          const codeTtl = await getTtl(otpCodeKey(phone));
          if (codeTtl > 0) await expireValue(otpAttemptsKey(phone), codeTtl);
        }
        return reply.code(401).send({ ok: false, message: 'Invalid code' });
      }

      await deleteValue(otpCodeKey(phone));
      await deleteValue(otpAttemptsKey(phone));
      await deleteValue(otpCooldownKey(phone));

      let user = await prisma.user.findUnique({ where: { phone } });
      if (!user) {
        user = await prisma.user.create({ data: { phone } });
      }

      logger.info('OTP verified', { phone, userId: user.id });

      const accessToken = signAccessToken(user.id, user.phone);
      const refreshToken = signRefreshToken(user.id);

      return {
        ok: true,
        user: { id: user.id, phone: user.phone },
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'bearer',
          expiresIn: '3600',
        },
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
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user) {
          return reply.code(401).send({ ok: false, message: 'User not found' });
        }

        return {
          ok: true,
          user: { id: user.id, phone: user.phone },
          tokens: {
            accessToken: signAccessToken(user.id, user.phone),
            refreshToken: signRefreshToken(user.id),
          },
        };
      } catch {
        return reply.code(401).send({ ok: false, message: 'Refresh token expired' });
      }
    }
  );

  fastify.post<{ Body: LogoutBody }>(
    '/logout',
    { schema: logoutSchema },
    async (_req) => {
      return { ok: true };
    }
  );
};

export default authRoutes;
