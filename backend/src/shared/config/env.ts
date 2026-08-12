import 'dotenv/config';

function validateDatabaseUrl(input: string) {
  const value = input.trim();

  if (!value) {
    throw new Error('DATABASE_URL is required');
  }

  if (/^https?:\/\//i.test(value)) {
    throw new Error('DATABASE_URL must be a Postgres connection string, not a Supabase project URL');
  }

  if (!/^postgres(ql)?:\/\//i.test(value)) {
    throw new Error('DATABASE_URL must start with postgresql:// or postgres://');
  }

  return value;
}

function validateRedisUrl(input: string) {
  const value = input.trim();

  if (!value) return ''; // Redis is optional — rate-limiter falls back to memory store

  if (!/^(redis|rediss):\/\//i.test(value)) {
    throw new Error('REDIS_URL must start with redis:// or rediss://');
  }

  return value;
}

function validateSupabaseUrl(input: string) {
  const value = input.trim();
  if (!value) return '';
  if (!/^https:\/\//i.test(value)) {
    throw new Error('SUPABASE_URL must be an https:// URL');
  }
  return value.replace(/\/+$/, '');
}

function validatePublicApiUrl(input: string) {
  const value = input.trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) {
    throw new Error('PUBLIC_API_URL must be an http(s):// URL');
  }
  return value.replace(/\/+$/, '');
}

// Google mints ID tokens with a different `aud` per platform (iOS/Android/Web client
// IDs) — accept all of them, not just one. Empty is valid pre-setup; /auth/google
// returns 501 until at least one is configured, rather than failing boot.
function parseGoogleClientIds(input: string | undefined) {
  return (input ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const DEV_JWT_SECRET_FALLBACK = 'dev-jwt-secret-do-not-use-in-production';

function validateJwtSecret(input: string | undefined, nodeEnv: string) {
  const value = input?.trim() ?? '';

  if (!value) {
    if (nodeEnv === 'production') {
      throw new Error('JWT_SECRET is required in production');
    }
    return DEV_JWT_SECRET_FALLBACK;
  }

  if (nodeEnv === 'production' && value === DEV_JWT_SECRET_FALLBACK) {
    throw new Error('JWT_SECRET must not use the development fallback value in production');
  }

  if (nodeEnv === 'production' && value.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }

  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env = {
  nodeEnv,
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: validateDatabaseUrl(process.env.DATABASE_URL ?? ''),
  redisUrl: validateRedisUrl(process.env.REDIS_URL ?? ''),
  supabaseUrl: validateSupabaseUrl(process.env.SUPABASE_URL ?? ''),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '',
  jwtSecret: validateJwtSecret(process.env.JWT_SECRET, nodeEnv),
  publicApiUrl: validatePublicApiUrl(process.env.PUBLIC_API_URL ?? ''),
  payfastMerchantId: process.env.PAYFAST_MERCHANT_ID?.trim() ?? '',
  payfastMerchantKey: process.env.PAYFAST_MERCHANT_KEY?.trim() ?? '',
  payfastPassphrase: process.env.PAYFAST_PASSPHRASE?.trim() ?? '',
  payfastMode: (process.env.PAYFAST_MODE?.trim().toLowerCase() === 'live' ? 'live' : 'sandbox') as
    | 'live'
    | 'sandbox',
  sentryDsn: process.env.SENTRY_DSN?.trim() ?? '',
  googleClientIds: parseGoogleClientIds(process.env.GOOGLE_CLIENT_IDS),
};

if (nodeEnv === 'production' && env.payfastMode === 'live' && (!env.payfastMerchantId || !env.payfastMerchantKey)) {
  throw new Error('PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY are required when PAYFAST_MODE=live in production');
}
