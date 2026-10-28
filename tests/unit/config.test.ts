import { describe, expect, test } from 'bun:test';
import { readConfig } from '../../src/config';

const settings = { APP_ENV: 'local', API_PORT: '3000' };

describe('startup settings', () => {
  test('converts the port and ignores settings the scaffold does not use', () => {
    const config = readConfig({ ...settings, POSTGRES_PASSWORD: 'unused synthetic secret' });
    expect(config).toEqual({ APP_ENV: 'local', API_PORT: 3000 });
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

  test('reports invalid fields without including submitted values', () => {
    const secret = 'synthetic-secret-never-log';
    expect(() => readConfig({ APP_ENV: secret, API_PORT: secret }))
      .toThrow('Invalid configuration fields: APP_ENV, API_PORT.');
  });
});
