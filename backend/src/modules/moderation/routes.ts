import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { applyAutoHold, notifyModerators } from '../../shared/moderation/actions.js';

const REPORT_REASONS = ['inappropriate_content', 'harassment', 'fake_profile', 'spam', 'underage', 'other'];

const moderationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: { userId: string } }>(
    '/block',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['userId'],
          properties: { userId: { type: 'string', minLength: 1, maxLength: 36 } },
        },
      },
    },
    async (req, reply) => {
      const blockerId = req.user.sub;
      const { userId: blockedId } = req.body;

      if (blockedId === blockerId) {
        return reply.code(400).send({ ok: false, message: 'Cannot block yourself' });
      }

      await prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      });

      return { ok: true };
    }
  );

  fastify.delete<{ Params: { userId: string } }>(
    '/block/:userId',
    { preHandler: [fastify.authenticate] },
    async (req) => {
      await prisma.block.deleteMany({
        where: { blockerId: req.user.sub, blockedId: req.params.userId },
      });
      return { ok: true };
    }
  );

  fastify.get('/blocked', { preHandler: [fastify.authenticate] }, async (req) => {
    const blocks = await prisma.block.findMany({
      where: { blockerId: req.user.sub },
      include: { blocked: { include: { profile: { select: { displayName: true } } } } },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ok: true,
      blocked: blocks.map((block) => ({
        userId: block.blockedId,
        name: block.blocked.profile?.displayName ?? block.blocked.email,
        blockedAt: block.createdAt.toISOString(),
      })),
    };
  });

  fastify.post<{
    Body: { userId: string; reason: string; details?: string; messageId?: string; roomMessageId?: string };
  }>(
    '/report',
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'reason'],
          properties: {
            userId: { type: 'string', minLength: 1, maxLength: 36 },
            reason: { type: 'string', enum: REPORT_REASONS },
            details: { type: 'string', maxLength: 1000 },
            messageId: { type: 'string', minLength: 1, maxLength: 36 },
            roomMessageId: { type: 'string', minLength: 1, maxLength: 36 },
          },
        },
      },
    },
    async (req, reply) => {
      const reporterId = req.user.sub;
      const { userId: reportedId, reason, details, messageId, roomMessageId } = req.body;

      if (reportedId === reporterId) {
        return reply.code(400).send({ ok: false, message: 'Cannot report yourself' });
      }

      const reported = await prisma.user.findUnique({ where: { id: reportedId }, select: { id: true } });
      if (!reported) return reply.code(404).send({ ok: false, message: 'User not found' });

      // Snapshot the reported content server-side so moderators see exactly what
      // was sent (and it survives the sender deleting it). Only messages the
      // reporter could actually see, written by the reported user, are accepted.
      let evidence: string | null = null;
      if (messageId) {
        const message = await prisma.message.findFirst({
          where: { id: messageId, senderId: reportedId, recipientId: reporterId },
        });
        if (message) {
          evidence = `[direct ${message.type} ${message.createdAt.toISOString()}] ${message.content ?? ''} ${message.mediaUrl ?? ''}`.trim();
        }
      } else if (roomMessageId) {
        const message = await prisma.roomMessage.findFirst({
          where: { id: roomMessageId, userId: reportedId },
          include: { room: { select: { name: true } } },
        });
        if (message) {
          evidence = `[room "${message.room.name}" ${message.createdAt.toISOString()}] ${message.content}`;
        }
      }

      const report = await prisma.report.create({
        data: { reporterId, reportedId, reason, details: details ?? null, evidence },
      });

      const held = await applyAutoHold(reportedId, reason);
      void notifyModerators(
        `${reason === 'underage' ? '🚨 URGENT ' : ''}New report (${reason}) against user ${reportedId}` +
          `${held ? ' — user auto-held pending review' : ''}. Report ${report.id}.` +
          `${evidence ? `\nEvidence: ${evidence.slice(0, 500)}` : ''}`
      );

      return { ok: true };
    }
  );
};

export default moderationRoutes;
