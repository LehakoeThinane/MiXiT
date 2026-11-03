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
  // Sign in with Apple — `aud` of identity tokens minted for the native iOS app is
  // the bundle identifier. Comma-separated so a Services ID can be added for web later.
  appleClientIds: parseGoogleClientIds(process.env.APPLE_CLIENT_IDS ?? 'com.mixit.app'),
  // Optional: enables revoking Apple tokens on account deletion (Apple requirement for
  // apps offering Sign in with Apple). Key from Apple Developer > Keys (Sign in with Apple).
  appleTeamId: process.env.APPLE_TEAM_ID?.trim() ?? '',
  appleKeyId: process.env.APPLE_KEY_ID?.trim() ?? '',
  applePrivateKey: (process.env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim(),
  // RevenueCat webhook — the exact value configured as the webhook "Authorization header"
  // in the RevenueCat dashboard. Empty = webhook disabled (returns 503).
  revenuecatWebhookAuth: process.env.REVENUECAT_WEBHOOK_AUTH?.trim() ?? '',
  // Moderation: admin API key for /admin/* (empty = admin API disabled) and an
  // optional Slack/Discord-compatible webhook that is pinged for every new report.
  adminApiKey: process.env.ADMIN_API_KEY?.trim() ?? '',
  moderationWebhookUrl: process.env.MODERATION_WEBHOOK_URL?.trim() ?? '',
  // Optional demo account for App Store / Play review teams (entered in "App access"
  // / "Sign-in information"). Both empty = reviewer sign-in disabled.
  reviewAccountEmail: process.env.REVIEW_ACCOUNT_EMAIL?.trim().toLowerCase() ?? '',
  reviewAccountPassword: process.env.REVIEW_ACCOUNT_PASSWORD?.trim() ?? '',
  // Shown on the public legal/support pages and used as the contact address.
  legalEntityName: process.env.LEGAL_ENTITY_NAME?.trim() || 'Peloentle Digital Solution',
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || 'mixit@peloentle.com',
};

if (nodeEnv === 'production' && env.payfastMode === 'live' && (!env.payfastMerchantId || !env.payfastMerchantKey)) {
  throw new Error('PAYFAST_MERCHANT_ID and PAYFAST_MERCHANT_KEY are required when PAYFAST_MODE=live in production');
}

if (env.adminApiKey && env.adminApiKey.length < 32) {
  throw new Error('ADMIN_API_KEY must be at least 32 characters (e.g. openssl rand -hex 32)');
}

if (env.reviewAccountEmail && env.reviewAccountPassword.length < 16) {
  throw new Error('REVIEW_ACCOUNT_PASSWORD must be at least 16 characters when REVIEW_ACCOUNT_EMAIL is set');
}
