import { describe, expect, test } from 'bun:test';
import { readCleanupConfig } from '../../src/cleanup-sessions';

const settings = {
  DATABASE_TASK_MODE: 'test',
  APP_ENV: 'test',
  API_PORT: '3002',
  API_ORIGIN: 'http://127.0.0.1:3002',
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '5435',
  POSTGRES_DB: 'finance_tracker_test',
  POSTGRES_USER: 'invented-user',
  POSTGRES_PASSWORD: 'invented-private-password',
};

describe('session cleanup configuration', () => {
  test.each([
    { mode: 'local', port: '5433', database: 'finance_tracker_local' },
    { mode: 'test', port: '5435', database: 'finance_tracker_test' },
    {
      mode: 'production',
      port: '5434',
      database: 'finance_tracker_production',
    },
  ])('accepts only the explicit $mode target', ({ mode, port, database }) => {
    const config = readCleanupConfig({
      ...settings,
      DATABASE_TASK_MODE: mode,
      APP_ENV: mode,
      API_ORIGIN:
        mode === 'production'
          ? 'https://api.example.test'
          : settings.API_ORIGIN,
      POSTGRES_PORT: port,
      POSTGRES_DB: database,
    });
    expect(config.APP_ENV).toBe(mode);
    expect(config.POSTGRES_PORT).toBe(Number(port));
    expect(config.POSTGRES_DB).toBe(database);
  });

  test.each([
    { DATABASE_TASK_MODE: undefined },
    { DATABASE_TASK_MODE: 'unknown' },
    { DATABASE_TASK_MODE: 'local' },
    { APP_ENV: 'local' },
    { POSTGRES_HOST: 'localhost' },
    { POSTGRES_HOST: 'db' },
    { POSTGRES_HOST: 'remote.example.test' },
    { POSTGRES_PORT: '5433' },
    { POSTGRES_DB: 'finance_tracker_local' },
  ])('rejects mismatched task settings: %j', (override) => {
    expect(() => readCleanupConfig({ ...settings, ...override })).toThrow(
      'Session cleanup requires the matching database task settings.',
    );
  });

  test('reuses configuration validation without exposing values', () => {
    expect(() =>
      readCleanupConfig({
        ...settings,
        POSTGRES_PORT: settings.POSTGRES_PASSWORD,
      }),
    ).toThrow('Invalid configuration fields: POSTGRES_PORT.');
  });

  test('the command refuses a mismatched target before attempting a connection', async () => {
    const child = Bun.spawn(
      [process.execPath, '--no-env-file', 'src/cleanup-sessions.ts'],
      {
        env: { ...settings, POSTGRES_HOST: 'remote.example.test' },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stdout).text()).toBe('');
    expect(await new Response(child.stderr).text()).toBe(
      'Session cleanup failed. Check the selected database settings and PostgreSQL availability.\n',
    );
  });
});
