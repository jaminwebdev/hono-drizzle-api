import { readConfig } from '../../src/config';
import { createDatabase } from '../../src/db/client';

export function createTestDatabase(source: Record<string, unknown> = process.env) {
  const config = readConfig(source);
  if (config.APP_ENV !== 'test' || config.POSTGRES_HOST !== '127.0.0.1'
    || config.POSTGRES_PORT !== 5435 || config.POSTGRES_DB !== 'finance_tracker_test') {
    throw new Error('Integration tests require the isolated test database settings.');
  }

  return createDatabase(config);
}
