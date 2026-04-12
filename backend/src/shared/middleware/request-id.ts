import type { FastifyReply, FastifyRequest } from 'fastify';

export async function requestIdMiddleware(req: FastifyRequest, _reply: FastifyReply) {
  req.log.debug({ requestId: req.id }, 'request received');
}
