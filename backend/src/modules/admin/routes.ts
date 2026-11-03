import crypto from 'node:crypto';

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { env } from '../../shared/config/env.js';
import { prisma } from '../../shared/db/prisma.js';
import { banUser, holdUser, releaseHold, unbanUser } from '../../shared/moderation/actions.js';
import { signChatMediaUrls } from '../../shared/storage/supabase-storage.js';

// Moderator API for working the report queue (App Store 1.2: act on reports of
// objectionable content within 24 hours). Authenticate with the header
//   x-admin-key: <ADMIN_API_KEY>
// Disabled entirely (404) until ADMIN_API_KEY is set.

function keyMatches(provided: string) {
  const a = Buffer.from(provided);
  const b = Buffer.from(env.adminApiKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!env.adminApiKey) {
    return reply.code(404).send({ ok: false, message: 'Not found' });
  }
  const provided = req.headers['x-admin-key'];
  if (typeof provided !== 'string' || !keyMatches(provided)) {
    return reply.code(401).send({ ok: false, message: 'Unauthorized' });
  }
}

const URL_RE = /https?:\/\/\S+/g;

/** Evidence may reference private chat media — give moderators signed links. */
async function signEvidence(evidence: string | null): Promise<string | null> {
  if (!evidence) return evidence;
  const urls = evidence.match(URL_RE) ?? [];
  if (urls.length === 0) return evidence;
  const signed = await signChatMediaUrls(urls);
  return evidence.replace(URL_RE, (url) => signed.get(url) ?? url);
}

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', requireAdmin);

  // ---- Report queue (oldest first, underage reports on top) ----
  fastify.get<{ Querystring: { status?: string; limit?: string } }>('/reports', async (req) => {
    const status = req.query.status ?? 'open';
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const reports = await prisma.report.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        reporter: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
        reported: {
          select: {
            id: true,
            email: true,
            bannedAt: true,
            heldAt: true,
            createdAt: true,
            profile: { select: { displayName: true, age: true, bio: true, photos: true, voiceIntroUrl: true } },
            _count: { select: { reportsReceived: true } },
          },
        },
      },
    });

    const sorted = [...reports].sort(
      (a, b) => Number(b.reason === 'underage') - Number(a.reason === 'underage')
    );

    return {
      ok: true,
      reports: await Promise.all(
        sorted.map(async (report) => ({
          ...report,
          evidence: await signEvidence(report.evidence),
          ageHours: Math.round((Date.now() - report.createdAt.getTime()) / 36e5),
        }))
      ),
    };
  });

  // ---- Full picture of one user ----
  fastify.get<{ Params: { userId: string } }>('/users/:userId', async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      include: {
        profile: true,
        reportsReceived: { orderBy: { createdAt: 'desc' }, take: 50 },
        roomMessages: { orderBy: { createdAt: 'desc' }, take: 50 },
        _count: { select: { reportsMade: true, blocksReceived: true, sent: true } },
      },
    });
    if (!user) return reply.code(404).send({ ok: false, message: 'User not found' });
    const { pushToken: _pushToken, ...profile } = user.profile ?? { pushToken: null };
    return { ok: true, user: { ...user, profile: user.profile ? profile : null } };
  });

  // ---- Resolve a report ----
  fastify.post<{
    Params: { reportId: string };
    Body: { action: 'dismiss' | 'warn' | 'hold' | 'ban'; note?: string };
  }>(
    '/reports/:reportId/resolve',
    {
      schema: {
        body: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['dismiss', 'warn', 'hold', 'ban'] },
            note: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const report = await prisma.report.findUnique({ where: { id: req.params.reportId } });
      if (!report) return reply.code(404).send({ ok: false, message: 'Report not found' });

      const { action, note } = req.body;
      if (action === 'ban') await banUser(report.reportedId, `report ${report.id}: ${report.reason}`);
      if (action === 'hold') await holdUser(report.reportedId);
      if (action === 'dismiss') {
        // Lift an automatic hold if nothing else is outstanding against the user.
        const otherOpen = await prisma.report.count({
          where: { reportedId: report.reportedId, status: 'open', id: { not: report.id } },
        });
        if (otherOpen === 0) await releaseHold(report.reportedId).catch(() => undefined);
      }

      const resolution = `${action}${note ? `: ${note}` : ''}`;
      // Banning resolves every open report against the user.
      await prisma.report.updateMany({
        where: action === 'ban' ? { reportedId: report.reportedId, status: 'open' } : { id: report.id },
        data: { status: action === 'dismiss' ? 'dismissed' : 'reviewed', reviewedAt: new Date(), resolution },
      });
      return { ok: true };
    }
  );

  // ---- Direct user actions ----
  fastify.post<{ Params: { userId: string }; Body: { reason?: string } }>('/users/:userId/ban', async (req) => {
    await banUser(req.params.userId, req.body?.reason ?? 'admin action');
    return { ok: true };
  });

  fastify.post<{ Params: { userId: string } }>('/users/:userId/unban', async (req) => {
    await unbanUser(req.params.userId);
    return { ok: true };
  });

  fastify.post<{ Params: { userId: string } }>('/users/:userId/release', async (req) => {
    await releaseHold(req.params.userId);
    return { ok: true };
  });
};

export default adminRoutes;
