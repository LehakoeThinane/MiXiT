import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';

export type AuthenticatedUser = {
  sub: string;
  phone: string;
};

type AccessTokenPayload = AuthenticatedUser & {
  type: 'access';
  iat?: number;
  exp?: number;
};

type RefreshTokenPayload = {
  sub: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
};

export function signAccessToken(sub: string, phone: string): string {
  return jwt.sign({ sub, phone, type: 'access' }, env.jwtSecret, { expiresIn: '1h' });
}

export function signRefreshToken(sub: string): string {
  return jwt.sign({ sub, type: 'refresh' }, env.jwtSecret, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string): AuthenticatedUser {
  const payload = jwt.verify(token, env.jwtSecret) as AccessTokenPayload;
  if (payload.type !== 'access') throw new Error('Not an access token');
  return { sub: payload.sub, phone: payload.phone };
}

export function verifyRefreshToken(token: string): { sub: string } {
  const payload = jwt.verify(token, env.jwtSecret) as RefreshTokenPayload;
  if (payload.type !== 'refresh') throw new Error('Not a refresh token');
  return { sub: payload.sub };
}

export function extractBearerToken(authorization: string | string[] | undefined): string | null {
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }
  if (Array.isArray(authorization) && authorization[0]?.startsWith('Bearer ')) {
    return authorization[0].slice(7).trim();
  }
  return null;
}
