import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import {
  refreshSupabaseSession,
  requestSupabaseOtp,
  resolveAuthenticatedUser,
  verifySupabaseOtp,
} from '../../shared/auth/supabase-auth.js';
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

type LogoutBody = {
  refreshToken: string;
};

function normalizePhone(input: string) {
  return input.replace(/\s+/g, '').trim();
}

function isValidPhone(phone: string) {
  return /^\+?[1-9]\d{7,14}$/.test(phone);
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

async function resolveLocalAuthUser(accessToken: string) {
  return resolveAuthenticatedUser(accessToken);
}

function isInfrastructureError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes('Supabase Auth request failed') ||
    error.message.includes('did not return a session') ||
    error.message.includes('did not return a refreshed session')
  );
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RequestOtpBody }>(
    '/request-otp',
    { schema: requestOtpSchema },
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone);
      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }

      try {
        await requestSupabaseOtp(phone);
        logger.info('Supabase OTP requested', { phone });

        return {
          ok: true,
          message: 'OTP sent',
        };
      } catch (error) {
        logger.error('Supabase OTP request failed', error);
        return reply.code(500).send({
          ok: false,
          message: error instanceof Error ? error.message : 'Failed to request OTP',
        });
      }
    }
  );

  fastify.post<{ Body: VerifyOtpBody }>(
    '/verify-otp',
    { schema: verifyOtpSchema },
    async (req, reply) => {
      const phone = normalizePhone(req.body.phone);
      const code = req.body.code.trim();

      if (!isValidPhone(phone)) {
        return reply.code(400).send({ ok: false, message: 'Invalid phone format' });
      }

      try {
        const session = await verifySupabaseOtp(phone, code);
        const localUser = await resolveLocalAuthUser(session.access_token);

        logger.info('Supabase OTP verified', {
          phone,
          localUserId: localUser.sub,
          supabaseUserId: localUser.supabaseUserId,
        });

        return {
          ok: true,
          user: {
            id: localUser.sub,
            phone: localUser.phone,
          },
          tokens: {
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
            tokenType: session.token_type ?? 'bearer',
            expiresIn: String(session.expires_in ?? ''),
          },
        };
      } catch (error) {
        logger.warn('Supabase OTP verification failed', { phone, error });
        if (isInfrastructureError(error)) {
          return reply.code(500).send({ ok: false, message: 'Authentication service unavailable' });
        }
        return reply.code(401).send({ ok: false, message: 'Invalid or expired OTP' });
      }
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
        const session = await refreshSupabaseSession(req.body.refreshToken);
        const localUser = await resolveLocalAuthUser(session.access_token);

        return {
          ok: true,
          user: {
            id: localUser.sub,
            phone: localUser.phone,
          },
          tokens: {
            accessToken: session.access_token,
            refreshToken: session.refresh_token,
          },
        };
      } catch (error) {
        logger.warn('Supabase refresh failed', error);
        if (isInfrastructureError(error)) {
          return reply.code(500).send({ ok: false, message: 'Authentication service unavailable' });
        }
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
