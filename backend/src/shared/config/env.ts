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

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: validateDatabaseUrl(process.env.DATABASE_URL ?? ''),
  redisUrl: validateRedisUrl(process.env.REDIS_URL ?? ''),
  supabaseUrl: validateSupabaseUrl(process.env.SUPABASE_URL ?? ''),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY?.trim() ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '',
  jwtSecret: process.env.JWT_SECRET?.trim() || 'dev-jwt-secret-do-not-use-in-production',
};
