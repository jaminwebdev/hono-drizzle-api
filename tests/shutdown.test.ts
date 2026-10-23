import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShutdown, SHUTDOWN_TIMEOUT_MS } from '../src/lib/shutdown.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('graceful shutdown', () => {
  it('waits for HTTP requests before closing the pool and handles repeated signals once', async () => {
    const order: string[] = [];
    let finishHttp = () => {};
    const markClosing = vi.fn(() => { order.push('closing'); });
    const stopHttp = vi.fn(() => new Promise<void>((resolve) => {
      order.push('http');
      finishHttp = resolve;
    }));
    const closeDatabase = vi.fn(() => {
      order.push('database');
      return Promise.resolve();
    });
    const shutdown = createShutdown({ markClosing, stopHttp, closeDatabase });

    const first = shutdown();
    expect(shutdown()).toBe(first);
    expect(order).toEqual(['closing', 'http']);
    expect(closeDatabase).not.toHaveBeenCalled();

    finishHttp();
    await first;

    expect(order).toEqual(['closing', 'http', 'database']);
    expect(markClosing).toHaveBeenCalledOnce();
    expect(stopHttp).toHaveBeenCalledOnce();
    expect(closeDatabase).toHaveBeenCalledOnce();
  });

  it('still closes the database if closing the HTTP server fails', async () => {
    const closeDatabase = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const shutdown = createShutdown({
      markClosing: () => {},
      stopHttp: () => Promise.reject(new Error('HTTP close failed.')),
      closeDatabase,
    });

    await expect(shutdown()).rejects.toThrow('HTTP close failed.');
    expect(closeDatabase).toHaveBeenCalledOnce();
  });

  it.each(['http', 'database'])('bounds shutdown when %s does not finish', async (stage) => {
    vi.useFakeTimers();
    const pending = () => new Promise<void>(() => {});
    const shutdown = createShutdown({
      markClosing: () => {},
      stopHttp: stage === 'http' ? pending : () => Promise.resolve(),
      closeDatabase: stage === 'database' ? pending : () => Promise.resolve(),
    });

    const rejection = expect(shutdown()).rejects.toThrow('Operation timed out.');
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});
