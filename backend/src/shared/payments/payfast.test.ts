import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_MERCHANT_ID = 'merchant123';
const DEFAULT_MERCHANT_KEY = 'key456';

const mockEnv: {
  payfastPassphrase: string;
  payfastMerchantId: string;
  payfastMerchantKey: string;
  payfastMode: 'sandbox' | 'live';
} = {
  payfastPassphrase: '',
  payfastMerchantId: DEFAULT_MERCHANT_ID,
  payfastMerchantKey: DEFAULT_MERCHANT_KEY,
  payfastMode: 'sandbox',
};

vi.mock('../config/env.js', () => ({ env: mockEnv }));

const {
  buildPaymentFields,
  generateSignature,
  getProcessUrl,
  isPayfastConfigured,
  payfastEncode,
  PAYMENT_FIELD_ORDER,
  verifyItnWithPayfast,
} = await import('./payfast.js');

beforeEach(() => {
  mockEnv.payfastPassphrase = '';
  mockEnv.payfastMerchantId = DEFAULT_MERCHANT_ID;
  mockEnv.payfastMerchantKey = DEFAULT_MERCHANT_KEY;
  mockEnv.payfastMode = 'sandbox';
});

const baseCheckoutInput = {
  merchantReference: 'ref-1',
  amountInCents: 9900,
  itemName: 'MiXiT Premium',
  returnUrl: 'https://api.example.com/payments/return',
  cancelUrl: 'https://api.example.com/payments/cancel',
  notifyUrl: 'https://api.example.com/payments/itn',
};

describe('payfastEncode', () => {
  it('encodes spaces as + (PHP urlencode style), not %20', () => {
    expect(payfastEncode('hello world')).toBe('hello+world');
  });

  it('percent-encodes other special characters', () => {
    expect(payfastEncode('R100 & more!')).toBe('R100+%26+more!');
  });
});

describe('generateSignature', () => {
  // Expected hashes computed independently via `node -e "crypto.createHash..."`,
  // not derived from this module, so they catch real regressions.
  it('matches an independently computed MD5 hash with no passphrase', () => {
    const signature = generateSignature({ a: '1', b: 'hello world' }, ['a', 'b']);
    expect(signature).toBe('82720b13731b460f68803817d8da8686');
  });

  it('appends the passphrase when one is configured', () => {
    mockEnv.payfastPassphrase = 'SecretPass1';
    const signature = generateSignature({ a: '1', b: 'hello world' }, ['a', 'b']);
    expect(signature).toBe('68d2459d6803239ffff82dd8a9ecb6b8');
  });

  it('skips blank and undefined fields', () => {
    const signature = generateSignature({ a: '1', b: '', c: '3', d: undefined }, ['a', 'b', 'c', 'd']);
    expect(signature).toBe('86f0264111f9e3db265b217462427c27');
  });

  it('only signs fields in the given order, ignoring extras', () => {
    const signature = generateSignature({ a: '1', b: 'hello world', extra: 'ignored' }, ['a', 'b']);
    expect(signature).toBe('82720b13731b460f68803817d8da8686');
  });

  it('returns a 32-character lowercase hex string', () => {
    expect(generateSignature({ a: '1' }, ['a'])).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('buildPaymentFields', () => {
  it('formats amount from cents to a 2-decimal string', () => {
    const fields = buildPaymentFields(baseCheckoutInput);
    expect(fields.amount).toBe('99.00');
  });

  it('includes merchant credentials from config', () => {
    const fields = buildPaymentFields(baseCheckoutInput);
    expect(fields.merchant_id).toBe(DEFAULT_MERCHANT_ID);
    expect(fields.merchant_key).toBe(DEFAULT_MERCHANT_KEY);
  });

  it('truncates item_name to 100 characters', () => {
    const fields = buildPaymentFields({ ...baseCheckoutInput, itemName: 'x'.repeat(150) });
    expect(fields.item_name).toHaveLength(100);
  });

  it('omits cell_number when no buyer phone is given', () => {
    const fields = buildPaymentFields(baseCheckoutInput);
    expect(fields.cell_number).toBeUndefined();
  });

  it('includes cell_number when a buyer phone is given', () => {
    const fields = buildPaymentFields({ ...baseCheckoutInput, buyerPhone: '0821234567' });
    expect(fields.cell_number).toBe('0821234567');
  });

  it('produces a signature matching an independent recomputation over the signed fields', () => {
    const fields = buildPaymentFields(baseCheckoutInput);
    const { signature, ...rest } = fields;
    expect(signature).toBe(generateSignature(rest, PAYMENT_FIELD_ORDER));
    expect(signature).toMatch(/^[0-9a-f]{32}$/);
  });

  it('changes the signature if any signed field changes', () => {
    const a = buildPaymentFields(baseCheckoutInput);
    const b = buildPaymentFields({ ...baseCheckoutInput, amountInCents: 100 });
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('isPayfastConfigured', () => {
  it('is true when both merchant id and key are set', () => {
    expect(isPayfastConfigured()).toBe(true);
  });

  it('is false when merchant credentials are missing', () => {
    mockEnv.payfastMerchantId = '';
    mockEnv.payfastMerchantKey = '';
    expect(isPayfastConfigured()).toBe(false);
  });
});

describe('getProcessUrl', () => {
  it('returns the sandbox URL by default', () => {
    expect(getProcessUrl()).toBe('https://sandbox.payfast.co.za/eng/process');
  });

  it('returns the live URL in live mode', () => {
    mockEnv.payfastMode = 'live';
    expect(getProcessUrl()).toBe('https://www.payfast.co.za/eng/process');
  });
});

describe('verifyItnWithPayfast', () => {
  const baseItn = {
    m_payment_id: 'ref-1',
    merchant_id: DEFAULT_MERCHANT_ID,
    payment_status: 'COMPLETE',
    amount_gross: '99.00',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts when PayFast confirms VALID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve('VALID') }));
    const result = await verifyItnWithPayfast(baseItn);
    expect(result.ok).toBe(true);
  });

  it('rejects (without throwing) when PayFast responds INVALID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve('INVALID') }));
    const result = await verifyItnWithPayfast(baseItn);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('INVALID');
  });

  it('rejects (without throwing) when the validate request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await verifyItnWithPayfast(baseItn);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('network down');
  });
});
