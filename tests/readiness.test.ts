import { afterEach, describe, expect, it, jest, mock } from 'bun:test';
import { createApp, READINESS_TIMEOUT_MS } from '../src/app.js';

afterEach(() => {
  jest.useRealTimers();
});

describe('database readiness', () => {
  it('checks the database before reporting ready and prevents cached responses', async () => {
    const checkDatabase = mock((): Promise<void> => Promise.resolve()).mockResolvedValue(undefined);
    const response = await createApp({ checkDatabase }).request('/health/ready');

    expect(checkDatabase).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ data: { status: 'ready' } });
  });

  it('returns a safe 503 error when the database fails', async () => {
    const checkDatabase = mock((): Promise<void> => Promise.resolve())
      .mockRejectedValue(new Error('password=private database failure'));
    const response = await createApp({ checkDatabase }).request('/health/ready');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service is not ready.',
        status: 503,
        requestId: response.headers.get('x-request-id'),
      },
    });
  });

  it('recovers on the next request after a database failure', async () => {
    const checkDatabase = mock((): Promise<void> => Promise.resolve())
      .mockRejectedValueOnce(new Error('Disconnected.'))
      .mockResolvedValue(undefined);
    const app = createApp({ checkDatabase });

    expect((await app.request('/health/ready')).status).toBe(503);
    expect((await app.request('/health/ready')).status).toBe(200);
  });

  it('keeps liveness available when the database is unavailable', async () => {
    const app = createApp();

    expect((await app.request('/health/live')).status).toBe(200);
    expect((await app.request('/health/ready')).status).toBe(503);
  });

  it('stops waiting when a readiness operation exceeds its deadline', async () => {
    jest.useFakeTimers();
    const checkDatabase = () => new Promise<void>(() => {});
    const pending = createApp({ checkDatabase }).request('/health/ready');

    // Let Hono's middleware reach the database check before moving the clock.
    for (let turn = 0; turn < 10 && jest.getTimerCount() === 0; turn++) {
      await Promise.resolve();
    }
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    jest.advanceTimersByTime(READINESS_TIMEOUT_MS);
    expect((await pending).status).toBe(503);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not check the database once shutdown has begun', async () => {
    const checkDatabase = mock((): Promise<void> => Promise.resolve()).mockResolvedValue(undefined);
    const app = createApp({ checkDatabase, isShuttingDown: () => true });

    expect((await app.request('/health/ready')).status).toBe(503);
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it('does not report ready if shutdown begins during the database check', async () => {
    let closing = false;
    const app = createApp({
      isShuttingDown: () => closing,
      checkDatabase: () => Promise.resolve().then(() => { closing = true; }),
    });

    expect((await app.request('/health/ready')).status).toBe(503);
  });
});
