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

  if (!value) {
    throw new Error('REDIS_URL is required');
  }

  if (!/^(redis|rediss):\/\//i.test(value)) {
    throw new Error('REDIS_URL must start with redis:// or rediss://');
  }

  return value;
}

function validateSupabaseUrl(input: string) {
  const value = input.trim();

  if (!value) {
    throw new Error('SUPABASE_URL is required');
  }

  if (!/^https:\/\//i.test(value)) {
    throw new Error('SUPABASE_URL must be an https:// URL');
  }

  return value.replace(/\/+$/, '');
}

function validateSupabaseAnonKey(input: string) {
  const value = input.trim();

  if (!value) {
    throw new Error('SUPABASE_ANON_KEY is required');
  }

  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: validateDatabaseUrl(process.env.DATABASE_URL ?? ''),
  redisUrl: validateRedisUrl(process.env.REDIS_URL ?? 'redis://localhost:6379'),
  supabaseUrl: validateSupabaseUrl(process.env.SUPABASE_URL ?? ''),
  supabaseAnonKey: validateSupabaseAnonKey(process.env.SUPABASE_ANON_KEY ?? ''),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '',
  otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),
  otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60),
  otpRequestWindowSeconds: Number(process.env.OTP_REQUEST_WINDOW_SECONDS ?? 600),
  otpMaxRequestsPerWindow: Number(process.env.OTP_MAX_REQUESTS_PER_WINDOW ?? 3),
  otpMaxVerifyAttempts: Number(process.env.OTP_MAX_VERIFY_ATTEMPTS ?? 5),
  smsProvider: process.env.SMS_PROVIDER ?? 'africastalking',
  atUsername: process.env.AT_USERNAME ?? '',
  atApiKey: process.env.AT_API_KEY ?? '',
  atSenderId: process.env.AT_SENDER_ID ?? '',
  smsportalBaseUrl: process.env.SMSPORTAL_BASE_URL ?? 'https://rest.smsportal.com',
  smsportalSendPath: process.env.SMSPORTAL_SEND_PATH ?? '/v3/BulkMessages',
  smsportalAuthMode: process.env.SMSPORTAL_AUTH_MODE ?? 'basic',
  smsportalClientId: process.env.SMSPORTAL_CLIENT_ID ?? '',
  smsportalApiSecret: process.env.SMSPORTAL_API_SECRET ?? '',
  smsportalBearerToken: process.env.SMSPORTAL_BEARER_TOKEN ?? '',
  smsportalOriginator: process.env.SMSPORTAL_ORIGINATOR ?? '',
};
