import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../shared/auth/supabase-auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}
