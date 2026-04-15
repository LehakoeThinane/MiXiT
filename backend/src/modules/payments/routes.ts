import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../shared/db/prisma.js';

// ---------------------------------------------------------------------------
// Seed products — Ensures default products exist in the database.
// Called lazily on the first list request.
// ---------------------------------------------------------------------------

const DEFAULT_PRODUCTS = [
  {
    slug: 'mixit-premium',
    name: 'MiXiT Premium',
    description:
      'Unlimited vibes, see who viewed your profile, priority in Discover, and ad-free experience.',
    priceInCents: 9900,
    currency: 'ZAR',
    type: 'subscription',
  },
  {
    slug: 'vibe-boost',
    name: 'Vibe Boost',
    description:
      'Get 10× more visibility for 30 minutes. Your profile appears at the top of Discover.',
    priceInCents: 2900,
    currency: 'ZAR',
    type: 'boost',
  },
  {
    slug: 'super-vibe',
    name: 'Super Vibe (5 pack)',
    description:
      'Send a Super Vibe to stand out. Recipients see your vibe first with a special highlight.',
    priceInCents: 4900,
    currency: 'ZAR',
    type: 'feature',
  },
];

async function ensureSeedProducts() {
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
      })),
    };
  });

  // ---- Subscribe / Purchase a product ----
  fastify.post<{
    Body: { productSlug: string };
  }>(
    '/subscribe',
    { preHandler: [fastify.authenticate] },
    async (req, reply) => {
      const userId = req.user.sub;
      const { productSlug } = req.body;

      if (!productSlug || typeof productSlug !== 'string') {
        return reply
          .code(400)
          .send({ ok: false, message: 'Missing product slug' });
      }

      const product = await prisma.product.findUnique({
        where: { slug: productSlug },
      });
      if (!product || !product.active) {
        return reply
          .code(404)
          .send({ ok: false, message: 'Product not found or inactive' });
      }

      // For subscriptions, check if user already has an active one
      if (product.type === 'subscription') {
        const existingActive = await prisma.userPurchase.findFirst({
          where: {
            userId,
            product: { type: 'subscription' },
            status: 'active',
          },
        });

        if (existingActive) {
          return reply
            .code(409)
            .send({ ok: false, message: 'You already have an active subscription' });
        }
      }

      // Default expiry: 30 days for subscriptions, 24h for boosts, null for features
      let expiresAt: Date | null = null;
      if (product.type === 'subscription') {
        expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else if (product.type === 'boost') {
        expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }

      const purchase = await prisma.userPurchase.create({
        data: {
          userId,
          productId: product.id,
          status: 'active',
          expiresAt,
        },
        include: { product: true },
      });

      return {
        ok: true,
        purchase: {
          id: purchase.id,
          productSlug: purchase.product.slug,
          productName: purchase.product.name,
          status: purchase.status,
          expiresAt: purchase.expiresAt?.toISOString() ?? null,
          createdAt: purchase.createdAt.toISOString(),
        },
      };
    }
  );

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
        (p) =>
          p.product.type === 'subscription' && p.status === 'active'
      );

      return {
        ok: true,
        premium: hasActivePremium,
        purchases: purchases.map((purchase) => ({
          id: purchase.id,
          productSlug: purchase.product.slug,
          productName: purchase.product.name,
          productType: purchase.product.type,
          status: purchase.status,
          price: formatPrice(
            purchase.product.priceInCents,
            purchase.product.currency
          ),
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
        return reply
          .code(400)
          .send({ ok: false, message: 'Missing purchase id' });
      }

      const purchase = await prisma.userPurchase.findFirst({
        where: { id: purchaseId, userId },
      });

      if (!purchase) {
        return reply
          .code(404)
          .send({ ok: false, message: 'Purchase not found' });
      }

      if (purchase.status !== 'active') {
        return reply
          .code(400)
          .send({ ok: false, message: 'Purchase is not active' });
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
