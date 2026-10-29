import { describe, expect, mock, test } from 'bun:test';
import { createApp } from '../../src/app';
import type { Database } from '../../src/db/client';

function appWith(query: () => Promise<unknown>) {
  const execute = mock(query);
  const database = { execute } as unknown as Database;
  return { app: createApp(database), execute };
}

describe('health routes', () => {
  test('constructing the app and checking liveness do not query PostgreSQL', async () => {
    const { app, execute } = appWith(() => Promise.resolve([]));
    expect(execute).not.toHaveBeenCalled();
    const response = await app.request('/health/live');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(execute).not.toHaveBeenCalled();
  });

  test('readiness succeeds when its database query succeeds', async () => {
    const { app, execute } = appWith(() => Promise.resolve([]));
    const response = await app.request('/health/ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test('readiness hides database errors and liveness remains available', async () => {
    const { app } = appWith(() => Promise.reject(new Error('synthetic secret in a driver error')));
    const response = await app.request('/health/ready');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: 'DATABASE_UNAVAILABLE', status: 503, requestId: response.headers.get('X-Request-Id') },
    });
    expect((await app.request('/health/live')).status).toBe(200);
  });
});
