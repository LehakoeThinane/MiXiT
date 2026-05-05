import { buildApp } from './app.js';
import { env } from './shared/config/env.js';
import { logger } from './shared/utils/logger.js';

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
    await app.listen({ host: env.host, port: env.port });
    logger.info(`API running on http://${env.host}:${env.port}`);
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

void start();
