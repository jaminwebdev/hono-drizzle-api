import { describe, expect, test } from 'bun:test';
import { readConfig } from '../../src/config';

const settings = {
  APP_ENV: 'local',
  API_PORT: '3000',
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5433',
  POSTGRES_USER: 'finance',
  POSTGRES_DB: 'finance_tracker_local',
  POSTGRES_PASSWORD: '  synthetic p@$word#:/?%  ',
} as const;

describe('startup settings', () => {
  test('converts ports, preserves credentials, and ignores unused settings', () => {
    const config = readConfig({ ...settings, CORS_ORIGINS: 'unused' });
    expect(config).toEqual({ ...settings, API_PORT: 3000, POSTGRES_PORT: 5433 });
  });

  test.each(['local', 'test', 'production'])('accepts APP_ENV=%s', (mode) => {
    expect(readConfig({ ...settings, APP_ENV: mode }).APP_ENV).toBe(mode);
  });

  test.each([undefined, '', 'development'])('rejects a missing or invalid APP_ENV: %s', (mode) => {
    expect(() => readConfig({ ...settings, APP_ENV: mode })).toThrow('APP_ENV');
  });

  test.each([undefined, '0', '65536', '3000extra', '3.5', '1e3'])(
    'rejects a missing or invalid API_PORT: %s', (port) => {
      expect(() => readConfig({ ...settings, API_PORT: port })).toThrow('API_PORT');
    },
  );

  test.each(['1', '65535'])('accepts port boundary %s', (port) => {
    expect(readConfig({ ...settings, API_PORT: port }).API_PORT).toBe(Number(port));
  });

  test.each(['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD'])(
    'requires %s rather than choosing a default database target', (field) => {
      const source: Record<string, unknown> = { ...settings };
      delete source[field];
      expect(() => readConfig(source)).toThrow(field);
    },
  );

  test('rejects blank database values and malformed database ports', () => {
    expect(() => readConfig({ ...settings, POSTGRES_HOST: '   ' })).toThrow('POSTGRES_HOST');
    expect(() => readConfig({ ...settings, POSTGRES_PASSWORD: '' })).toThrow('POSTGRES_PASSWORD');
    expect(() => readConfig({ ...settings, POSTGRES_PORT: '5433extra' })).toThrow('POSTGRES_PORT');
  });

  test('reports invalid fields without including submitted values', () => {
    const secret = 'synthetic-secret-never-log';
    expect(() => readConfig({ ...settings, APP_ENV: secret, API_PORT: secret }))
      .toThrow('Invalid configuration fields: APP_ENV, API_PORT.');
  });
});
