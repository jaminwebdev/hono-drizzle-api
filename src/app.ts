import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { withTimeout } from './lib/with-timeout.js';

export const READINESS_TIMEOUT_MS = 3_000;

interface AppDependencies {
  checkDatabase?: () => Promise<void>;
  isShuttingDown?: () => boolean;
}

export function createApp({
  checkDatabase,
  isShuttingDown = () => false,
}: AppDependencies = {}) {
  const app = new Hono();

  app.use('*', requestId());

  app.use('/health/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.get('/health/live', (c) => c.json({ data: { status: 'ok' } }));

  app.get('/health/ready', async (c) => {
    try {
      if (isShuttingDown() || !checkDatabase) throw new Error('Not ready.');
      await withTimeout(checkDatabase, READINESS_TIMEOUT_MS);
      if (isShuttingDown()) throw new Error('Shutting down.');

      return c.json({ data: { status: 'ready' } });
    } catch {
      return c.json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service is not ready.',
          status: 503,
          requestId: c.get('requestId'),
        },
      }, 503);
    }
  });

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found.',
          status: 404,
          requestId: c.get('requestId'),
        },
      },
      404,
    ),
  );

  return app;
}
