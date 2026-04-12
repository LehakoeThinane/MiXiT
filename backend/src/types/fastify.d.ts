import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string;
      phone: string;
      type: 'access' | 'refresh';
    };
    user: {
      sub: string;
      phone: string;
      type: 'access' | 'refresh';
      iat?: number;
      exp?: number;
    };
  }
}
