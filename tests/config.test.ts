import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/lib/config.js';

const credentials = {
  APP_ENV: 'local',
  POSTGRES_USER: 'finance',
  POSTGRES_PASSWORD: 'test-password',
  POSTGRES_DB: 'finance',
};

function fromEnvironment(values: NodeJS.ProcessEnv) {
  return loadConfig({ environment: 'local', source: 'environment', values });
}

const directories: string[] = [];

function fixture(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'finance-config-'));
  directories.push(directory);
  for (const [filename, contents] of Object.entries(files)) {
    writeFileSync(join(directory, filename), contents);
  }
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
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
    expect(() => loadConfig({
      environment: 'production', source: 'environment', values: credentials,
    })).toThrow('APP_ENV must match');
  });

  it('requires explicit, known environment and source selections', () => {
    for (const environment of [undefined, 'staging', '../local']) {
      expect(() => loadConfig({ environment, source: 'file' })).toThrow('Select local or production');
    }
    expect(() => loadConfig({ environment: 'local', source: undefined }))
      .toThrow('Select local or production');
  });
});

describe('environment file isolation', () => {
  it('uses injected production settings without reading an existing local file', () => {
    const directory = fixture({ '.env.local': 'APP_ENV=local\nPOSTGRES_PASSWORD=local-secret\n' });
    const config = loadConfig({
      environment: 'production',
      source: 'environment',
      directory,
      values: { ...credentials, APP_ENV: 'production', POSTGRES_PASSWORD: 'production-secret' },
    });

    expect(config.environment).toBe('production');
    expect(config.database.password).toBe('production-secret');
  });

  it('reads only the selected file and ignores inherited credentials', () => {
    const directory = fixture({
      '.env.local': "APP_ENV=local\nPOSTGRES_USER=local\nPOSTGRES_DB=local\nPOSTGRES_PASSWORD='local@#/$ password'\n",
      '.env.production': 'APP_ENV=production\nPOSTGRES_USER=production\nPOSTGRES_DB=production\nPOSTGRES_PASSWORD=production-only\n',
    });

    const local = loadConfig({ environment: 'local', source: 'file', directory, values: {} });
    const production = loadConfig({
      environment: 'production', source: 'file', directory, values: credentials,
    });

    expect(local.database.password).toBe('local@#/$ password');
    expect(production.database.user).toBe('production');
    expect(production.database.password).toBe('production-only');
  });

  it('does not fall back to a local or generic file when production is missing', () => {
    const directory = fixture({
      '.env.local': 'APP_ENV=local\nPOSTGRES_PASSWORD=local-secret\n',
      '.env': 'POSTGRES_PASSWORD=generic-secret\n',
    });

    expect(() => loadConfig({
      environment: 'production', source: 'file', directory, values: credentials,
    })).toThrow('Unable to read .env.production.');
  });

  it('does not fill missing production fields from local files or inherited values', () => {
    const directory = fixture({
      '.env.production': 'APP_ENV=production\nPOSTGRES_USER=production\nPOSTGRES_DB=production\n',
      '.env.local': 'POSTGRES_PASSWORD=local-secret\n',
    });

    expect(() => loadConfig({
      environment: 'production', source: 'file', directory, values: credentials,
    })).toThrow('Invalid configuration fields: POSTGRES_PASSWORD.');
  });
});
