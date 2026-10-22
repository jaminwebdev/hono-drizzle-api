import { Hono } from 'hono';
import { requestId } from 'hono/request-id';

export function createApp() {
  const app = new Hono();

  app.use('*', requestId());

  app.get('/health/live', (c) => c.json({ data: { status: 'ok' } }));

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
