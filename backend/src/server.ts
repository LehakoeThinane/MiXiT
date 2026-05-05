import { buildApp } from './app.js';
import { env } from './shared/config/env.js';
import { logger } from './shared/utils/logger.js';

function maskUrl(value: string) {
  if (!value) return '(missing)';

  try {
    const url = new URL(value);
    const host = url.host || '(unknown-host)';
    const pathname = url.pathname && url.pathname !== '/' ? url.pathname : '';
    return `${url.protocol}//${host}${pathname}`;
  } catch {
    return '(invalid-url)';
  }
}

function maskSecret(value: string) {
  if (!value) return '(missing)';
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

process.on('uncaughtException', (error) => {
  logger.error('UNCAUGHT_EXCEPTION', { message: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('UNHANDLED_REJECTION', { message, stack });
  process.exit(1);
});

async function start() {
  const app = buildApp();

  try {
    logger.info('Boot config', {
      cwd: process.cwd(),
      nodeEnv: env.nodeEnv,
      host: env.host,
      port: env.port,
      corsOrigin: env.corsOrigin,
      databaseUrl: maskUrl(env.databaseUrl),
      redisUrl: maskUrl(env.redisUrl),
      supabaseUrl: maskUrl(env.supabaseUrl),
      supabaseAnonKey: env.supabaseAnonKey ? maskSecret(env.supabaseAnonKey) : '(missing)',
      smsProvider: env.smsProvider,
      atUsername: env.atUsername ? maskSecret(env.atUsername) : '(missing)',
      atApiKey: env.atApiKey ? maskSecret(env.atApiKey) : '(missing)',
      atSenderId: env.atSenderId || '(missing)',
      smsportalBaseUrl: maskUrl(env.smsportalBaseUrl),
      smsportalAuthMode: env.smsportalAuthMode,
      smsportalClientId: env.smsportalClientId ? maskSecret(env.smsportalClientId) : '(missing)',
      smsportalApiSecret: env.smsportalApiSecret ? maskSecret(env.smsportalApiSecret) : '(missing)',
      smsportalBearerToken: env.smsportalBearerToken ? maskSecret(env.smsportalBearerToken) : '(missing)',
      smsportalOriginator: env.smsportalOriginator || '(missing)',
    });

    await app.listen({ host: env.host, port: env.port });
    logger.info(`API running on http://${env.host}:${env.port}`);
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

void start();
