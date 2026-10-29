import { defineConfig } from 'drizzle-kit';
import { readConfig } from './src/config';

const config = readConfig(process.env);
const mode = process.env.DATABASE_TASK_MODE;
const target = mode === 'local'
  ? { port: 5433, database: 'finance_tracker_local' }
  : mode === 'test'
    ? { port: 5435, database: 'finance_tracker_test' }
    : undefined;

if (!target || config.APP_ENV !== mode || config.POSTGRES_HOST !== '127.0.0.1'
  || config.POSTGRES_PORT !== target.port || config.POSTGRES_DB !== target.database) {
  throw new Error('Database task refused: use the matching local or test database settings.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  dbCredentials: {
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    user: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    database: config.POSTGRES_DB,
    ssl: false,
  },
});
