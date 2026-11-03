import type { FastifyPluginAsync } from 'fastify';

import { env } from '../../shared/config/env.js';
import { prisma } from '../../shared/db/prisma.js';
import { ensureReferralCode, MAX_INVITER_REWARDS, normalizeReferralCode } from '../../shared/referrals/referrals.js';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mixit.app';

function inviteLink(code: string) {
  return `${env.publicApiUrl}/i/${code}`;
}

// ---- Authenticated: my invite code, link and stats ----
export const referralRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (req) => {
    const userId = req.user.sub;
    const code = await ensureReferralCode(userId);
    const [joined, rewarded] = await Promise.all([
      prisma.user.count({ where: { referredById: userId } }),
      prisma.user.count({ where: { referredById: userId, referralRewardedAt: { not: null } } }),
    ]);
    return {
      ok: true,
      code,
      link: inviteLink(code),
      joined,
      rewarded,
      maxRewardsPerMonth: MAX_INVITER_REWARDS,
    };
  });
};

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- Public: the page an invite link opens (WhatsApp previews it too) ----
export const invitePageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { code: string } }>('/:code', async (req, reply) => {
    const code = normalizeReferralCode(req.params.code);
    const appLink = code ? `mixit://invite/${code}` : 'mixit://';
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Join me on MiXiT</title>
<meta property="og:title" content="Join me on MiXiT" />
<meta property="og:description" content="Meet people near you, join rooms and chat. Use my invite and we both get a free Vibe Boost." />
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #060710; color: #f4f6ff; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  main { max-width: 420px; padding: 32px 24px; text-align: center; }
  h1 { color: #ff6b35; font-size: 40px; margin: 0 0 8px; letter-spacing: 1px; }
  p { color: #c6cbe2; line-height: 1.5; }
  a.btn { display: block; margin: 14px 0; padding: 14px; border-radius: 14px; text-decoration: none; font-weight: 700; }
  .primary { background: #ff6b35; color: #111524; }
  .secondary { border: 1px solid rgba(255,255,255,0.3); color: #f4f6ff; }
  code { background: rgba(255,255,255,0.1); padding: 4px 10px; border-radius: 8px; font-size: 18px; letter-spacing: 2px; }
</style>
</head>
<body>
<main>
  <h1>MiXiT</h1>
  <p>A friend invited you to MiXiT. Join with their invite and you both get a free 30-minute Vibe Boost.</p>
  ${code ? `<p>Invite code: <code>${escapeHtml(code)}</code></p>` : ''}
  <a class="btn primary" href="${escapeHtml(appLink)}">Open in MiXiT</a>
  <a class="btn secondary" href="${PLAY_STORE_URL}">Get MiXiT on Google Play</a>
  <p style="font-size:13px">Already installed? Tap “Open in MiXiT”, then sign up — your invite is applied automatically.</p>
</main>
</body>
</html>`;
    return reply.type('text/html; charset=utf-8').send(html);
  });
};
