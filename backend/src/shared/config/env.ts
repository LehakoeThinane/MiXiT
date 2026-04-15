import 'dotenv/config';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 300),
  otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60),
  otpRequestWindowSeconds: Number(process.env.OTP_REQUEST_WINDOW_SECONDS ?? 600),
  otpMaxRequestsPerWindow: Number(process.env.OTP_MAX_REQUESTS_PER_WINDOW ?? 3),
  otpMaxVerifyAttempts: Number(process.env.OTP_MAX_VERIFY_ATTEMPTS ?? 5),
  smsProvider: process.env.SMS_PROVIDER ?? 'africastalking',
  atUsername: process.env.AT_USERNAME ?? '',
  atApiKey: process.env.AT_API_KEY ?? '',
  atSenderId: process.env.AT_SENDER_ID ?? '',
};
