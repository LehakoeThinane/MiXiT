import type { FastifyRequest } from 'fastify';

import { verifyAccessToken, extractBearerToken } from '../auth/jwt.js';
import { env } from '../config/env.js';

/**
 * The real client IP.
 *
 * Behind Fly.io every request arrives from Fly's proxy, so `req.ip` is the
 * proxy, not the user. `X-Forwarded-For` doesn't help: its rightmost entry is
 * the app's own IP, and earlier entries can be supplied by the client (spoofable).
 * Fly's proxy sets `Fly-Client-IP` itself, so we trust that one header — only
 * when CLIENT_IP_HEADER is configured (fly.toml), because without the proxy in
 * front any client could set it.
 */
export function clientIp(req: FastifyRequest): string {
  if (env.clientIpHeader) {
    const value = req.headers[env.clientIpHeader];
    const ip = (Array.isArray(value) ? value[0] : value)?.trim();
    if (ip) return ip;
  }
  return req.ip;
}

/**
 * Rate-limit key. Requests with a valid access token are keyed by user, so
 * several users behind one IP (mobile carrier NAT, campus Wi-Fi) don't share a
 * bucket. The token is fully verified, not just decoded — otherwise anyone could
 * put a victim's id in a forged token and exhaust the victim's allowance.
 * Everything else is keyed by client IP.
 */
export function rateLimitKey(req: FastifyRequest): string {
  const token = extractBearerToken(req.headers.authorization);
  if (token) {
    try {
      return `user:${verifyAccessToken(token).sub}`;
    } catch {
      // invalid/expired token — fall through to IP
    }
  }
  return `ip:${clientIp(req)}`;
}
