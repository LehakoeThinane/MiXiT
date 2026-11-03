import crypto from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';
import { env } from '../../shared/config/env.js';
import { logger } from '../../shared/utils/logger.js';
import {
  buildPaymentFields,
  getProcessUrl,
  isPayfastConfigured,
  verifyItnWithPayfast,
} from '../../shared/payments/payfast.js';

// ---------------------------------------------------------------------------
// Seed products — Ensures default products exist in the database.
// Called lazily on the first list request.
// ---------------------------------------------------------------------------

// Descriptions must only promise what the app actually does (App Store 2.3.1 /
// 3.1.2, Play deceptive-behaviour policy) — see the premium/boost ranking in
// matching/routes.ts.
export const BOOST_DURATION_MS = 30 * 60 * 1000;

const DEFAULT_PRODUCTS = [
  {
    slug: 'mixit-premium',
    name: 'MiXiT Premium',
    description:
      'Priority placement in Discover — your profile is shown to more people, ahead of non-Premium profiles, for as long as you subscribe. Renews monthly until cancelled.',
    priceInCents: 9900,
    currency: 'ZAR',
    type: 'subscription',
    active: true,
  },
  {
    slug: 'vibe-boost',
    name: 'Vibe Boost',
    description: 'Put your profile at the very top of Discover for 30 minutes, starting as soon as you buy it.',
    priceInCents: 2900,
    currency: 'ZAR',
    type: 'boost',
    active: true,
  },
  {
    // Retired: the Super Vibe highlight was never built. Kept (inactive) so any
    // historical purchase rows still resolve their product.
    slug: 'super-vibe',
    name: 'Super Vibe (5 pack)',
    description: null,
    priceInCents: 4900,
    currency: 'ZAR',
    type: 'feature',
    active: false,
  },
];

// App Store Connect / Play Console product IDs → our catalog slugs. Create the
// products in both consoles with exactly these IDs (Play subscriptions arrive from
// RevenueCat as "<productId>:<basePlanId>", handled in slugForStoreProduct).
export const STORE_PRODUCT_IDS: Record<string, string> = {
  'mixit-premium': 'mixit_premium_monthly',
  'vibe-boost': 'mixit_vibe_boost',
};

function slugForStoreProduct(storeProductId: string): string | null {
  const baseId = storeProductId.split(':')[0];
  return Object.entries(STORE_PRODUCT_IDS).find(([, id]) => id === baseId)?.[0] ?? null;
}

export async function ensureSeedProducts() {
  await Promise.all(
    DEFAULT_PRODUCTS.map((product) =>
      prisma.product.upsert({
        where: { slug: product.slug },
        create: product,
        update: {
          name: product.name,
          description: product.description,
          priceInCents: product.priceInCents,
          currency: product.currency,
          type: product.type,
          active: product.active,
        },
      })
    )
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(cents: number, currency: string) {
  const major = (cents / 100).toFixed(2);
  return `${currency} ${major}`;
}

function expiryForProductType(type: string): Date | null {
  if (type === 'subscription') return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (type === 'boost') return new Date(Date.now() + BOOST_DURATION_MS);
  return null;
}

function isStorePurchase(merchantReference: string) {
  return merchantReference.startsWith('rc:');
}

function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RevenueCatEvent = {
  type: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  new_product_id?: string;
  store?: string;
  environment?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  purchased_at_ms?: number;
  expiration_at_ms?: number | null;
  cancel_reason?: string;
  price_in_purchased_currency?: number;
  price?: number;
  currency?: string;
};

/** The app calls Purchases.logIn(<our user id>), so one of these is our users.id. */
async function resolveRevenueCatUser(event: RevenueCatEvent): Promise<string | null> {
  const candidates = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])].filter(
    (id): id is string => Boolean(id && UUID_RE.test(id))
  );
  for (const id of new Set(candidates)) {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (user) return user.id;
  }
  return null;
}

async function applyRevenueCatEvent(event: RevenueCatEvent): Promise<void> {
  const userId = await resolveRevenueCatUser(event);
  if (!userId) {
    logger.warn('RevenueCat event for unknown user', { type: event.type, appUserId: event.app_user_id });
    return;
  }

  const storeProductId = event.type === 'PRODUCT_CHANGE' ? event.new_product_id ?? event.product_id : event.product_id;
  const slug = storeProductId ? slugForStoreProduct(storeProductId) : null;
  const product = slug ? await prisma.product.findUnique({ where: { slug } }) : null;
  if (!product) {
    logger.warn('RevenueCat event for unmapped product', { type: event.type, productId: storeProductId });
    return;
  }

  const store = (event.store ?? 'store').toLowerCase();
  const amountInCents = Math.round((event.price_in_purchased_currency ?? event.price ?? 0) * 100);
  const currency = event.currency ?? 'USD';

  // ---- Consumable: Vibe Boost activates immediately for 30 minutes ----
  if (product.type === 'boost') {
    if (event.type !== 'NON_RENEWING_PURCHASE' || !event.transaction_id) return;
    const merchantReference = `rc:${store}:${event.transaction_id}`;
    await prisma.userPurchase.upsert({
      where: { merchantReference },
      update: {},
      create: {
        userId,
        productId: product.id,
        status: 'active',
        merchantReference,
        gatewayPaymentId: merchantReference,
        amountInCents,
        currency,
        expiresAt: new Date(Date.now() + BOOST_DURATION_MS),
      },
    });
    return;
  }

  // ---- Auto-renewing subscription: one row per original transaction ----
  const originalId = event.original_transaction_id ?? event.transaction_id;
  if (!originalId) return;
  const merchantReference = `rc:${store}:${originalId}`;
  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : null;

  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'SUBSCRIPTION_EXTENDED':
    case 'TEMPORARY_ENTITLEMENT_GRANT':
    case 'REFUND_REVERSED':
    case 'TRANSFER':
      await prisma.userPurchase.upsert({
        where: { merchantReference },
        update: { userId, productId: product.id, status: 'active', expiresAt, cancelledAt: null },
        create: {
          userId,
          productId: product.id,
          status: 'active',
          merchantReference,
          amountInCents,
          currency,
          expiresAt,
        },
      });
      return;
    case 'CANCELLATION':
      if (event.cancel_reason === 'CUSTOMER_SUPPORT') {
        // Refunded — access ends now.
        await prisma.userPurchase.updateMany({
          where: { merchantReference },
          data: { status: 'cancelled', cancelledAt: new Date(), expiresAt: new Date() },
        });
      } else {
        // Auto-renew turned off — Premium continues until the paid period ends.
        await prisma.userPurchase.updateMany({
          where: { merchantReference },
          data: { cancelledAt: new Date(), ...(expiresAt ? { expiresAt } : {}) },
        });
      }
      return;
    case 'EXPIRATION':
      await prisma.userPurchase.updateMany({
        where: { merchantReference },
        data: { status: 'expired', ...(expiresAt ? { expiresAt } : {}) },
      });
      return;
    default:
      // BILLING_ISSUE (grace period keeps expiresAt), SUBSCRIPTION_PAUSED, TEST, etc.
      return;
  }
}

// PayFast's cell_number field expects a local 0-prefixed SA number; our
// User.phone is stored in +27 international format.
function toLocalCellNumber(phone: string): string | null {
  const match = phone.match(/^\+27(\d{9})$/);
  return match ? `0${match[1]}` : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCheckoutRedirectPage(fields: Record<string, string>): string {
  const inputs = Object.entries(fields)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`)
    .join('\n      ');

  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Redirecting to PayFast…</title></head>
  <body onload="document.forms[0].submit()">
    <p>Redirecting to PayFast…</p>
    <form method="POST" action="${escapeHtml(getProcessUrl())}">
      ${inputs}
      <noscript><button type="submit">Continue to PayFast</button></noscript>
    </form>
  </body>
</html>`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  // ---- List available products ----
  fastify.get('/products', async () => {
    await ensureSeedProducts();

    const products = await prisma.product.findMany({
      where: { active: true },
      orderBy: { priceInCents: 'asc' },
    });

    return {
      ok: true,
      products: products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        description: product.description,
        price: formatPrice(product.priceInCents, product.currency),
        priceInCents: product.priceInCents,
        currency: product.currency,
        type: product.type,
        storeProductId: STORE_PRODUCT_IDS[product.slug] ?? null,
      })),
    };
  });

  // ---- RevenueCat webhook: App Store / Google Play purchase lifecycle ----
  // iOS and Android sell digital goods only through Apple/Google billing (App Store
  // 3.1.1, Play Payments policy). RevenueCat validates receipts with the stores and
  // calls this endpoint; it is the source of truth for native purchases.
  fastify.post('/revenuecat/webhook', async (req, reply) => {
    if (!env.revenuecatWebhookAuth) {
      return reply.code(503).send({ ok: false, message: 'RevenueCat webhook not configured' });
    }
    const authHeader = req.headers.authorization ?? '';
    if (!safeEqual(authHeader, env.revenuecatWebhookAuth) && !safeEqual(authHeader, `Bearer ${env.revenuecatWebhookAuth}`)) {
      return reply.code(401).send({ ok: false });
    }

    const event = (req.body as { event?: RevenueCatEvent } | undefined)?.event;
    if (!event?.type) return reply.code(400).send({ ok: false, message: 'Missing event' });

    await applyRevenueCatEvent(event);
    logger.info('RevenueCat event processed', { type: event.type, environment: event.environment });
    return { ok: true };
  });

  // ---- Start a PayFast checkout (web only — native apps must use store billing) ----
  fastify.post<{
    Body: { productSlug: string };
  }>(
    '/subscribe',
    {
      preHandler: [fastify.authenticate],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['productSlug'],
          properties: { productSlug: { type: 'string', minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (req, reply) => {
      if (!isPayfastConfigured() || !env.publicApiUrl) {
        return reply.code(503).send({ ok: false, message: 'Payments are not configured yet' });
      }

      const userId = req.user.sub;
      const { productSlug } = req.body;

      const product = await prisma.product.findUnique({ where: { slug: productSlug } });
      if (!product || !product.active) {
        return reply.code(404).send({ ok: false, message: 'Product not found or inactive' });
      }

      if (product.type === 'subscription') {
        const existingActive = await prisma.userPurchase.findFirst({
          where: { userId, product: { type: 'subscription' }, status: 'active' },
        });
        if (existingActive) {
          return reply.code(409).send({ ok: false, message: 'You already have an active subscription' });
        }
      }

      const purchase = await prisma.userPurchase.create({
        data: {
          userId,
          productId: product.id,
          status: 'pending',
          merchantReference: crypto.randomUUID(),
          amountInCents: product.priceInCents,
          currency: product.currency,
        },
      });

      return {
        ok: true,
        checkoutUrl: `${env.publicApiUrl}/payments/checkout/${purchase.merchantReference}`,
      };
    }
  );

  // ---- Self-submitting redirect bridge into PayFast's hosted checkout ----
  // Unauthenticated by necessity (PayFast/the device's browser hits this,
  // not our API client) — protected only by the unguessable UUID reference,
  // which was handed only to the authenticated user who created it.
  // Default Helmet CSP disallows the inline onload="" that auto-submits this page
  // to PayFast — this route serves a one-off redirect bridge, not JSON, so relax
  // CSP here only rather than weakening it globally.
  fastify.get<{ Params: { reference: string } }>('/checkout/:reference', { helmet: { contentSecurityPolicy: false } }, async (req, reply) => {
    const purchase = await prisma.userPurchase.findUnique({
      where: { merchantReference: req.params.reference },
      include: { product: true, user: { select: { phone: true } } },
    });

    if (!purchase) return reply.code(404).send('Checkout not found');
    if (purchase.status !== 'pending') return reply.code(410).send('This checkout has already been processed');

    const fields = buildPaymentFields({
      merchantReference: purchase.merchantReference,
      amountInCents: purchase.amountInCents,
      itemName: purchase.product.name,
      itemDescription: purchase.product.description,
      returnUrl: `${env.publicApiUrl}/payments/return?ref=${purchase.merchantReference}`,
      cancelUrl: `${env.publicApiUrl}/payments/cancel?ref=${purchase.merchantReference}`,
      notifyUrl: `${env.publicApiUrl}/payments/itn`,
      buyerPhone: purchase.user.phone ? toLocalCellNumber(purchase.user.phone) : null,
    });

    return reply.type('text/html; charset=utf-8').send(renderCheckoutRedirectPage(fields));
  });

  // ---- PayFast server-to-server payment confirmation ----
  fastify.post('/itn', async (req, reply) => {
    const rawBody = req.body as Record<string, string>;
    const merchantReference = rawBody?.m_payment_id;

    if (!merchantReference) {
      logger.warn('PayFast ITN missing m_payment_id');
      return reply.code(200).send({ ok: false });
    }

    const verification = await verifyItnWithPayfast(rawBody);
    if (!verification.ok) {
      logger.error('PayFast ITN failed verification', { merchantReference, reason: verification.reason });
      return reply.code(200).send({ ok: false });
    }

    if (rawBody.merchant_id !== env.payfastMerchantId) {
      logger.warn('PayFast ITN merchant_id mismatch', { merchantReference });
      return reply.code(200).send({ ok: false });
    }

    const purchase = await prisma.userPurchase.findUnique({
      where: { merchantReference },
      include: { product: true },
    });
    if (!purchase) {
      logger.warn('PayFast ITN for unknown purchase', { merchantReference });
      return reply.code(200).send({ ok: false });
    }

    const expectedAmount = purchase.amountInCents / 100;
    const receivedAmount = Number(rawBody.amount_gross);
    if (!Number.isFinite(receivedAmount) || Math.abs(receivedAmount - expectedAmount) > 0.01) {
      logger.warn('PayFast ITN amount mismatch', {
        merchantReference,
        expectedAmount,
        receivedAmount: rawBody.amount_gross,
      });
      return reply.code(200).send({ ok: false });
    }

    if (purchase.status !== 'pending') {
      // Already processed (PayFast retries ITNs) — acknowledge without reprocessing.
      return reply.code(200).send({ ok: true });
    }

    if (rawBody.payment_status === 'COMPLETE') {
      await prisma.userPurchase.update({
        where: { id: purchase.id },
        data: {
          status: 'active',
          gatewayPaymentId: rawBody.pf_payment_id ?? null,
          expiresAt: expiryForProductType(purchase.product.type),
        },
      });
      logger.info('PayFast purchase confirmed', { merchantReference, userId: purchase.userId });
    } else {
      await prisma.userPurchase.update({
        where: { id: purchase.id },
        data: { status: 'failed' },
      });
    }

    return reply.code(200).send({ ok: true });
  });

  // ---- Browser return points — hand back off to the app via deep link ----
  fastify.get<{ Querystring: { ref?: string } }>('/return', async (req, reply) => {
    return reply.redirect(`mixit://payments/return?ref=${encodeURIComponent(req.query.ref ?? '')}`);
  });

  fastify.get<{ Querystring: { ref?: string } }>('/cancel', async (req, reply) => {
    const ref = req.query.ref;
    if (ref) {
      await prisma.userPurchase.updateMany({
        where: { merchantReference: ref, status: 'pending' },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
    }
    return reply.redirect(`mixit://payments/cancel?ref=${encodeURIComponent(ref ?? '')}`);
  });

  // ---- Get user's purchases ----
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (req) => {
      const userId = req.user.sub;

      // Auto-expire old purchases
      await prisma.userPurchase.updateMany({
        where: {
          userId,
          status: 'active',
          expiresAt: { lt: new Date() },
        },
        data: { status: 'expired' },
      });

      const purchases = await prisma.userPurchase.findMany({
        where: { userId },
        include: { product: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const hasActivePremium = purchases.some(
        (p) => p.product.type === 'subscription' && p.status === 'active'
      );

      return {
        ok: true,
        premium: hasActivePremium,
        purchases: purchases.map((purchase) => ({
          id: purchase.id,
          productSlug: purchase.product.slug,
          productName: purchase.product.name,
          productType: purchase.product.type,
          source: isStorePurchase(purchase.merchantReference) ? 'store' : 'payfast',
          status: purchase.status,
          price: formatPrice(purchase.amountInCents, purchase.currency),
          expiresAt: purchase.expiresAt?.toISOString() ?? null,
          cancelledAt: purchase.cancelledAt?.toISOString() ?? null,
          createdAt: purchase.createdAt.toISOString(),
        })),
      };
    }
  );

  // ---- Cancel a purchase / subscription ----
  fastify.delete<{
    Params: { purchaseId: string };
  }>(
    '/me/:purchaseId',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.sub;
      const { purchaseId } = req.params;

      if (!purchaseId) {
        return reply.code(400).send({ ok: false, message: 'Missing purchase id' });
      }

      const purchase = await prisma.userPurchase.findFirst({
        where: { id: purchaseId, userId },
      });

      if (!purchase) {
        return reply.code(404).send({ ok: false, message: 'Purchase not found' });
      }

      if (purchase.status !== 'active') {
        return reply.code(400).send({ ok: false, message: 'Purchase is not active' });
      }

      if (isStorePurchase(purchase.merchantReference)) {
        return reply.code(400).send({
          ok: false,
          message: 'Manage this subscription in your App Store or Google Play account settings.',
        });
      }

      await prisma.userPurchase.update({
        where: { id: purchaseId },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
        },
      });

      return { ok: true };
    }
  );
};

export default paymentRoutes;
