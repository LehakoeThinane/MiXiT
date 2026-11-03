import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const KEYS_TTL_MS = 60 * 60 * 1000;

type AppleJwk = { kid: string; kty: string; alg: string; use: string; n: string; e: string };

let cachedKeys: { keys: AppleJwk[]; fetchedAt: number } | null = null;

async function getAppleKeys(forceRefresh = false): Promise<AppleJwk[]> {
  if (!forceRefresh && cachedKeys && Date.now() - cachedKeys.fetchedAt < KEYS_TTL_MS) {
    return cachedKeys.keys;
  }
  const response = await fetch(APPLE_KEYS_URL);
  if (!response.ok) throw new Error(`Failed to fetch Apple keys (${response.status})`);
  const body = (await response.json()) as { keys: AppleJwk[] };
  cachedKeys = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

export type AppleIdentity = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
};

/** Verifies a Sign in with Apple identity token (signature, issuer, audience, expiry). */
export async function verifyAppleIdentityToken(identityToken: string): Promise<AppleIdentity> {
  const decoded = jwt.decode(identityToken, { complete: true });
  const kid = decoded && typeof decoded === 'object' ? decoded.header.kid : undefined;
  if (!kid) throw new Error('Malformed Apple identity token');

  let jwk = (await getAppleKeys()).find((key) => key.kid === kid);
  if (!jwk) {
    // Apple rotates keys — refetch once before giving up.
    jwk = (await getAppleKeys(true)).find((key) => key.kid === kid);
  }
  if (!jwk) throw new Error('Unknown Apple signing key');

  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const payload = jwt.verify(identityToken, publicKey, {
    algorithms: ['RS256'],
    issuer: APPLE_ISSUER,
    audience: env.appleClientIds as [string, ...string[]],
  }) as jwt.JwtPayload & { email?: string; email_verified?: boolean | string };

  if (!payload.sub) throw new Error('Apple identity token missing subject');

  return {
    sub: payload.sub,
    email: payload.email ?? null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
  };
}

export function isAppleRevocationConfigured() {
  return Boolean(env.appleTeamId && env.appleKeyId && env.applePrivateKey && env.appleClientIds[0]);
}

function buildClientSecret(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: env.appleTeamId, iat: now, exp: now + 300, aud: APPLE_ISSUER, sub: env.appleClientIds[0] },
    env.applePrivateKey,
    { algorithm: 'ES256', keyid: env.appleKeyId }
  );
}

/**
 * Exchanges a fresh authorization code for a refresh token and revokes it, which
 * removes the app from the user's "Sign in with Apple" list. Apple requires this
 * when an account created with Sign in with Apple is deleted. Best effort.
 */
export async function revokeAppleAuthorization(authorizationCode: string): Promise<boolean> {
  if (!isAppleRevocationConfigured()) {
    logger.warn('Apple token revocation skipped — APPLE_TEAM_ID/APPLE_KEY_ID/APPLE_PRIVATE_KEY not set');
    return false;
  }

  try {
    const clientId = env.appleClientIds[0];
    const clientSecret = buildClientSecret();

    const tokenResponse = await fetch(`${APPLE_ISSUER}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenResponse.ok) {
      logger.warn('Apple token exchange failed', { status: tokenResponse.status });
      return false;
    }
    const tokens = (await tokenResponse.json()) as { refresh_token?: string; access_token?: string };
    const token = tokens.refresh_token ?? tokens.access_token;
    if (!token) return false;

    const revokeResponse = await fetch(`${APPLE_ISSUER}/auth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token,
        token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token',
      }),
    });
    return revokeResponse.ok;
  } catch (error) {
    logger.warn('Apple token revocation errored', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
