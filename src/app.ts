import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Database } from './db/client';
import { createAuthRoutes } from './features/auth';
import { ApiError, installHttp, type HttpEnv, type HttpSettings } from './http';

export function createApp(database: Database, settings: HttpSettings) {
  const app = new Hono<HttpEnv>();
  installHttp(app, settings);
  app.route('/api/v1/auth', createAuthRoutes(database));

  app.get('/health/live', (c) => {
    return c.json({ status: 'ok' });
  });

  app.get('/health/ready', async (c) => {
    try {
      await database.execute(sql`select 1`);
      return c.json({ status: 'ok' });
    } catch {
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable.');
    }
  });

  return app;
}
