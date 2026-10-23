import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/lib/config.js';

const credentials = {
  APP_ENV: 'local',
  POSTGRES_USER: 'finance',
  POSTGRES_PASSWORD: 'test-password',
  POSTGRES_DB: 'finance',
};

function fromEnvironment(values: NodeJS.ProcessEnv) {
  return loadConfig('local', values);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('configuration validation', () => {
  it('uses the Docker database address and separate connection fields', () => {
    const config = fromEnvironment({ ...credentials, POSTGRES_PORT: '15433' });

    expect(config.apiPort).toBe(3000);
    expect(config.databaseHostPort).toBe(15433);
    expect(config.database).toEqual({
      host: 'db',
      port: 5432,
      user: 'finance',
      password: 'test-password',
      database: 'finance',
    });
  });

  it.each(['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'])(
    'rejects missing %s without exposing other credentials',
    (field) => {
      const values: NodeJS.ProcessEnv = { ...credentials };
      delete values[field];

      expect(() => fromEnvironment(values)).toThrow(`Invalid configuration fields: ${field}.`);
    },
  );

  it.each(['', '   ', '\0'])('rejects blank or invalid passwords', (password) => {
    expect(() => fromEnvironment({ ...credentials, POSTGRES_PASSWORD: password }))
      .toThrow('Invalid configuration fields: POSTGRES_PASSWORD.');
  });

  it.each(['0', '-1', '65536', '3.5', '3e3', 'abc', '', ' 3000 '])(
    'rejects invalid ports: %s',
    (port) => {
      for (const field of ['API_PORT', 'POSTGRES_PORT']) {
        expect(() => fromEnvironment({ ...credentials, [field]: port }))
          .toThrow(`Invalid configuration fields: ${field}.`);
      }
    },
  );

  it('accepts valid port boundaries', () => {
    const config = fromEnvironment({ ...credentials, API_PORT: '65535', POSTGRES_PORT: '1' });
    expect(config.apiPort).toBe(65535);
    expect(config.databaseHostPort).toBe(1);
  });

  it('preserves passwords containing URL-reserved characters', () => {
    const password = ' p@ss:/?#[]$%&=word ';
    expect(fromEnvironment({ ...credentials, POSTGRES_PASSWORD: password }).database.password)
      .toBe(password);
  });

  it('rejects an environment that differs from the requested mode', () => {
    expect(() => loadConfig('production', credentials)).toThrow('APP_ENV must match');
  });

  it.each([undefined, 'staging', '../local'])(
    'requires a known startup mode: %s',
    (environment) => {
      expect(() => loadConfig(environment, credentials)).toThrow('Select local or production');
    },
  );

  it.each([undefined, '', 'staging'])(
    'rejects a missing or unknown APP_ENV: %s',
    (environment) => {
      expect(() => fromEnvironment({ ...credentials, APP_ENV: environment }))
        .toThrow('Invalid configuration fields: APP_ENV.');
    },
  );

  it('accepts production values supplied by the container', () => {
    const config = loadConfig('production', {
      ...credentials,
      APP_ENV: 'production',
      POSTGRES_USER: 'production-user',
      POSTGRES_PASSWORD: 'production-password',
    });

    expect(config.environment).toBe('production');
    expect(config.database.user).toBe('production-user');
    expect(config.database.password).toBe('production-password');
  });

  it('reads process.env when no test values are supplied', () => {
    for (const [key, value] of Object.entries(credentials)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv('API_PORT', '4000');
    vi.stubEnv('POSTGRES_PORT', '15433');

    const config = loadConfig('local');
    expect(config.apiPort).toBe(4000);
    expect(config.database.password).toBe('test-password');
  });

  it('does not fill missing production credentials from inherited local values', () => {
    vi.stubEnv('POSTGRES_PASSWORD', 'local-secret');
    const values: NodeJS.ProcessEnv = { ...credentials, APP_ENV: 'production' };
    delete values.POSTGRES_PASSWORD;

    expect(() => loadConfig('production', values))
      .toThrow('Invalid configuration fields: POSTGRES_PASSWORD.');
  });
});
