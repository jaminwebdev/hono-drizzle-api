import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Database } from './db/client';

export function createApp(database: Database) {
  const app = new Hono();

  app.get('/health/live', (c) => {
    return c.json({ status: 'ok' });
  });

  app.get('/health/ready', async (c) => {
    try {
      await database.execute(sql`select 1`);
      return c.json({ status: 'ok' });
    } catch {
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  return app;
}
