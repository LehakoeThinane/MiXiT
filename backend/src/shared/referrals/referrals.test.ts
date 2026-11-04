import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({ prisma: {} }));
vi.mock('../../modules/payments/routes.js', () => ({ BOOST_DURATION_MS: 1, ensureSeedProducts: vi.fn() }));

const { normalizeReferralCode } = await import('./referrals.js');

describe('normalizeReferralCode', () => {
  it('accepts 8-character codes case-insensitively', () => {
    expect(normalizeReferralCode('abcd2345')).toBe('ABCD2345');
    expect(normalizeReferralCode('  ABCD2345 ')).toBe('ABCD2345');
  });

  it('rejects anything else', () => {
    expect(normalizeReferralCode('ABC')).toBeNull();
    expect(normalizeReferralCode('ABCD-2345')).toBeNull();
    expect(normalizeReferralCode(42)).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
});
