import { describe, expect, it } from 'bun:test';
import { requireTestDatabaseName, testDatabaseOptions } from './support/database.js';

const settings = {
  RUN_DATABASE_TESTS: '1',
  TEST_DATABASE_HOST: '127.0.0.1',
  TEST_DATABASE_PORT: '15435',
  TEST_DATABASE_USER: 'finance_test',
  TEST_DATABASE_PASSWORD: 'finance_test',
};

describe('database test target guards', () => {
  it('uses only the dedicated test credentials and a published loopback port', () => {
    expect(testDatabaseOptions(settings)).toMatchObject({
      host: '127.0.0.1', port: 15435, user: 'finance_test', database: 'finance_test', ssl: false,
    });
  });

  it.each([
    ['RUN_DATABASE_TESTS', undefined],
    ['RUN_DATABASE_TESTS', '0'],
    ['TEST_DATABASE_HOST', 'db'],
    ['TEST_DATABASE_PORT', undefined],
    ['TEST_DATABASE_PORT', '0'],
    ['TEST_DATABASE_PORT', '65536'],
    ['TEST_DATABASE_PORT', '1.5'],
    ['TEST_DATABASE_HOST', 'production-db'],
    ['TEST_DATABASE_USER', 'finance'],
    ['TEST_DATABASE_PASSWORD', 'local-password'],
  ])('rejects unexpected settings for %s', (field, value) => {
    expect(() => testDatabaseOptions({ ...settings, [field]: value }))
      .toThrow('isolated Compose test settings');
  });

  it.each([undefined, '', 'finance', 'finance_test', 'finance_production',
    'finance_test_123', 'finance_test_";drop database finance;--'])('rejects a database outside the generated namespace: %s', (name) => {
    expect(() => requireTestDatabaseName(name)).toThrow('generated test namespace');
  });

  it('accepts the database name generated for one run', () => {
    const name = 'finance_test_1234567890abcdef1234567890abcdef';
    expect(requireTestDatabaseName(name)).toBe(name);
  });
});
