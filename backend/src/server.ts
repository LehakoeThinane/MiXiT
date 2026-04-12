import { buildApp } from './app.js';
import { env } from './shared/config/env.js';
import { logger } from './shared/utils/logger.js';

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
