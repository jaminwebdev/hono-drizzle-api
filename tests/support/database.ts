import type { Client, Pool } from 'pg';

export const TEST_ADMIN_DATABASE = 'finance_test';

export function testDatabaseOptions(values: NodeJS.ProcessEnv = process.env) {
  const port = Number(values.TEST_DATABASE_PORT);
  if (values.RUN_DATABASE_TESTS !== '1' || values.TEST_DATABASE_HOST !== '127.0.0.1' ||
      !/^\d+$/.test(values.TEST_DATABASE_PORT ?? '') || !Number.isInteger(port) || port < 1 || port > 65535 ||
      values.TEST_DATABASE_USER !== 'finance_test' ||
      values.TEST_DATABASE_PASSWORD !== 'finance_test') {
    throw new Error('Database tests require the isolated Compose test settings.');
  }

  return {
    host: '127.0.0.1',
    port,
    user: 'finance_test',
    password: 'finance_test',
    database: TEST_ADMIN_DATABASE,
    ssl: false,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
  };
}

export function requireTestDatabaseName(name: string | undefined): string {
  if (!name || !/^finance_test_[a-f0-9]{32}$/.test(name)) {
    throw new Error('Refusing to use a database outside the generated test namespace.');
  }
  return name;
}

export async function verifyTestDatabase(connection: Client | Pool, expected: string) {
  if (expected !== TEST_ADMIN_DATABASE) requireTestDatabaseName(expected);
  const result = await connection.query<{ database: string; user: string }>(
    'select current_database() as database, current_user as "user"',
  );
  if (result.rows[0]?.database !== expected || result.rows[0].user !== 'finance_test') {
    throw new Error('Refusing database test setup or cleanup on an unexpected database.');
  }
}
