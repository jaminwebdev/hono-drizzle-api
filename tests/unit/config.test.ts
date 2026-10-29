import { describe, expect, test } from 'bun:test';
import { readConfig } from '../../src/config';

const settings = {
  APP_ENV: 'local',
  API_PORT: '3000',
  API_ORIGIN: 'http://127.0.0.1:3000',
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5433',
  POSTGRES_USER: 'finance',
  POSTGRES_DB: 'finance_tracker_local',
  POSTGRES_PASSWORD: '  synthetic p@$word#:/?%  ',
} as const;

describe('startup settings', () => {
  test('converts ports, preserves credentials, and ignores unused settings', () => {
    const config = readConfig({ ...settings, UNUSED_SETTING: 'unused' });
    expect(config).toEqual({ ...settings, API_PORT: 3000, POSTGRES_PORT: 5433, CORS_ORIGINS: [] });
  });

  test.each(['local', 'test', 'production'])('accepts APP_ENV=%s', (mode) => {
    const origin = mode === 'production' ? 'https://api.example.com' : settings.API_ORIGIN;
    expect(readConfig({ ...settings, APP_ENV: mode, API_ORIGIN: origin }).APP_ENV).toBe(mode);
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

  test.each([undefined, '', '*', 'null', 'example.com', 'http://example.com/', 'http://example.com/path',
    'http://example.com?secret=value', 'http://user:secret@example.com', 'ftp://example.com'])(
    'requires an exact HTTP or HTTPS API_ORIGIN: %s', (origin) => {
      expect(() => readConfig({ ...settings, API_ORIGIN: origin })).toThrow('API_ORIGIN');
    },
  );

  test('requires HTTPS for the production API origin', () => {
    expect(() => readConfig({ ...settings, APP_ENV: 'production' })).toThrow('API_ORIGIN must use HTTPS');
  });

  test('accepts an empty CORS setting and parses an explicit browser allowlist', () => {
    expect(readConfig({ ...settings, CORS_ORIGINS: '' }).CORS_ORIGINS).toEqual([]);
    expect(readConfig({ ...settings, CORS_ORIGINS: 'http://localhost:5173, https://ui.example.com' }).CORS_ORIGINS)
      .toEqual(['http://localhost:5173', 'https://ui.example.com']);
    expect(() => readConfig({ ...settings, CORS_ORIGINS: '*' })).toThrow('CORS_ORIGINS');
    expect(() => readConfig({ ...settings, CORS_ORIGINS: 'http://localhost:5173,' })).toThrow('CORS_ORIGINS');
  });
});
