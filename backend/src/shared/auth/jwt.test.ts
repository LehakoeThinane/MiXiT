import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import {
  extractBearerToken,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './jwt.js';

describe('access tokens', () => {
  it('round-trips sub and phone through sign/verify', () => {
    const token = signAccessToken('user-1', '+27821234567');
    const payload = verifyAccessToken(token);
    expect(payload).toEqual({ sub: 'user-1', phone: '+27821234567' });
  });

  it('rejects a refresh token presented as an access token', () => {
    const refreshToken = signRefreshToken('user-1');
    expect(() => verifyAccessToken(refreshToken)).toThrow();
  });

  it('rejects a garbage token', () => {
    expect(() => verifyAccessToken('not-a-real-token')).toThrow();
  });

  it('rejects a token signed with a different secret (forged token)', () => {
    const forged = jwt.sign({ sub: 'attacker', phone: '+27000000000', type: 'access' }, 'wrong-secret', {
      expiresIn: '1h',
    });
    expect(() => verifyAccessToken(forged)).toThrow();
  });
});

describe('refresh tokens', () => {
  it('round-trips sub through sign/verify', () => {
    const token = signRefreshToken('user-2');
    expect(verifyRefreshToken(token)).toEqual({ sub: 'user-2' });
  });

  it('rejects an access token presented as a refresh token', () => {
    const accessToken = signAccessToken('user-2', '+27821234567');
    expect(() => verifyRefreshToken(accessToken)).toThrow();
  });
});

describe('hashToken', () => {
  it('is deterministic', () => {
    expect(hashToken('same-input')).toBe(hashToken('same-input'));
  });

  it('produces different hashes for different input', () => {
    expect(hashToken('input-a')).not.toBe(hashToken('input-b'));
  });

  it('returns a 64-character lowercase hex string (sha256)', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('extractBearerToken', () => {
  it('extracts the token from a "Bearer <token>" header', () => {
    expect(extractBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('extracts from the first element when given an array header', () => {
    expect(extractBearerToken(['Bearer abc123', 'Bearer other'])).toBe('abc123');
  });

  it('returns null when the header is missing', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null when the header has no Bearer prefix', () => {
    expect(extractBearerToken('abc123')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractBearerToken('')).toBeNull();
  });
});
