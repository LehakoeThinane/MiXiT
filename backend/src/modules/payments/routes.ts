import type { FastifyPluginAsync } from 'fastify';

const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/products', async () => {
    return { ok: true, products: [] };
  });
};

export default paymentRoutes;
