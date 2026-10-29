import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Database } from './db/client';
import { errorResponse, installHttp, type HttpEnv } from './http';

export function createApp(database: Database) {
  const app = new Hono<HttpEnv>();
  installHttp(app);

  app.get('/health/live', (c) => {
    return c.json({ status: 'ok' });
  });

  app.get('/health/ready', async (c) => {
    try {
      await database.execute(sql`select 1`);
      return c.json({ status: 'ok' });
    } catch {
      return errorResponse(c, 503, 'DATABASE_UNAVAILABLE', 'The database is unavailable.');
    }
  });

  return app;
}
