// Must be imported before any other module (see server.ts) so Sentry's
// instrumentation is in place before anything it needs to observe loads.
import * as Sentry from '@sentry/node';

import { env } from './shared/config/env.js';

if (env.sentryDsn) {
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    tracesSampleRate: env.nodeEnv === 'production' ? 0.2 : 1.0,
    // server.ts already has its own uncaughtException/unhandledRejection handlers
    // that log and exit — drop Sentry's default ones so they don't race ours with
    // their own process.exit() before our handler gets to run.
    integrations: (integrations) =>
      integrations.filter((i) => i.name !== 'OnUncaughtException' && i.name !== 'OnUnhandledRejection'),
  });
}
