import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { readConfig } from '../config';

export function createDatabase(config: ReturnType<typeof readConfig>) {
  const client = new SQL({
    adapter: 'postgres',
    hostname: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    username: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
    max: 5,
    connectionTimeout: 5,
    idleTimeout: 30,
    connection: { statement_timeout: 5000 },
  });

  return drizzle({ client });
}

export type Database = ReturnType<typeof createDatabase>;
