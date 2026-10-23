import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { AppConfig } from '../lib/config.js';

export function createDatabase(connection: AppConfig['database']) {
  const pool = new Pool({
    ...connection,
    max: 10,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 2_000,
    query_timeout: 2_500,
    application_name: 'hono-drizzle-api',
  });

  // Idle connections can fail when PostgreSQL restarts. Handle the event safely.
  pool.on('error', () => {
    console.error('Database pool connection error.');
  });

  const db = drizzle(pool);

  return {
    db,
    async checkConnection() {
      await db.execute(sql`select 1`);
    },
    close: () => pool.end(),
  };
}
