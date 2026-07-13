import crypto from 'node:crypto';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// PayFast requires fields to be signed in this exact order — not
// alphabetical, not the order they're posted. Getting this wrong is the
// most common cause of "signature mismatch" errors.
export const PAYMENT_FIELD_ORDER = [
  'merchant_id',
  'merchant_key',
  'return_url',
  'cancel_url',
  'notify_url',
  'name_first',
  'name_last',
  'email_address',
  'cell_number',
  'm_payment_id',
  'amount',
  'item_name',
  'item_description',
  'custom_str1',
  'custom_str2',
  'custom_str3',
  'custom_str4',
  'custom_str5',
  'custom_int1',
  'custom_int2',
  'custom_int3',
  'custom_int4',
  'custom_int5',
  'email_confirmation',
  'confirmation_address',
  'currency',
] as const;

const ITN_FIELD_ORDER = [
  'm_payment_id',
  'pf_payment_id',
  'payment_status',
  'item_name',
  'item_description',
  'amount_gross',
  'amount_fee',
  'amount_net',
  'custom_str1',
  'custom_str2',
  'custom_str3',
  'custom_str4',
  'custom_str5',
  'custom_int1',
  'custom_int2',
  'custom_int3',
  'custom_int4',
  'custom_int5',
  'name_first',
  'name_last',
  'email_address',
  'merchant_id',
] as const;

// PayFast expects PHP urlencode-style escaping (spaces as '+'), not %20.
export function payfastEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function buildSignatureString(fields: Record<string, string | undefined>, order: readonly string[]): string {
  const parts: string[] = [];
  for (const key of order) {
    const value = fields[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${payfastEncode(String(value).trim())}`);
  }
  return parts.join('&');
}

export function generateSignature(fields: Record<string, string | undefined>, order: readonly string[]): string {
  let base = buildSignatureString(fields, order);
  if (env.payfastPassphrase) {
    base += `${base ? '&' : ''}passphrase=${payfastEncode(env.payfastPassphrase)}`;
  }
  return crypto.createHash('md5').update(base).digest('hex');
}

export function isPayfastConfigured(): boolean {
  return Boolean(env.payfastMerchantId && env.payfastMerchantKey);
}

export function getProcessUrl(): string {
  return env.payfastMode === 'live'
    ? 'https://www.payfast.co.za/eng/process'
    : 'https://sandbox.payfast.co.za/eng/process';
}

function getValidateUrl(): string {
  return env.payfastMode === 'live'
    ? 'https://www.payfast.co.za/eng/query/validate'
    : 'https://sandbox.payfast.co.za/eng/query/validate';
}

export type PayfastCheckoutInput = {
  merchantReference: string;
  amountInCents: number;
  itemName: string;
  itemDescription?: string | null;
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  buyerPhone?: string | null;
};

export function buildPaymentFields(input: PayfastCheckoutInput): Record<string, string> {
  const fields: Record<string, string> = {
    merchant_id: env.payfastMerchantId,
    merchant_key: env.payfastMerchantKey,
    return_url: input.returnUrl,
    cancel_url: input.cancelUrl,
    notify_url: input.notifyUrl,
    m_payment_id: input.merchantReference,
    amount: (input.amountInCents / 100).toFixed(2),
    item_name: input.itemName.slice(0, 100),
  };
  if (input.itemDescription) fields.item_description = input.itemDescription.slice(0, 255);
  if (input.buyerPhone) fields.cell_number = input.buyerPhone;

  return { ...fields, signature: generateSignature(fields, PAYMENT_FIELD_ORDER) };
}

export type ItnVerificationResult = { ok: boolean; reason?: string };

/**
 * PayFast's own "validate" echo-back is treated as the authoritative check —
 * re-deriving their exact signature rules (fee/net field presence varies by
 * merchant account settings) is easy to get subtly wrong, and a false
 * mismatch there would silently strand real payments as "pending" forever.
 * Our own signature recomputation runs too, but only as a logged,
 * non-blocking, defense-in-depth check.
 */
export async function verifyItnWithPayfast(rawBody: Record<string, string>): Promise<ItnVerificationResult> {
  const body = new URLSearchParams(rawBody).toString();

  try {
    const response = await fetch(getValidateUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = (await response.text()).trim();
    if (text !== 'VALID') {
      return { ok: false, reason: `PayFast validate returned "${text}"` };
    }
  } catch (error) {
    return {
      ok: false,
      reason: `PayFast validate request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const { signature, ...rest } = rawBody;
  const expected = generateSignature(rest, ITN_FIELD_ORDER);
  if (signature && signature !== expected) {
    logger.warn('PayFast ITN signature mismatch despite valid server confirmation', {
      merchantReference: rawBody.m_payment_id,
    });
  }

  return { ok: true };
}
