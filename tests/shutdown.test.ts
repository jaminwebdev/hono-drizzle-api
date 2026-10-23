import { afterEach, describe, expect, it, jest, mock } from 'bun:test';
import { createShutdown, SHUTDOWN_TIMEOUT_MS } from '../src/lib/shutdown.js';

afterEach(() => {
  jest.useRealTimers();
});

async function expectFailure(operation: Promise<void>, message: string) {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe(message);
}

describe('graceful shutdown', () => {
  it('waits for HTTP requests before closing the pool and handles repeated signals once', async () => {
    const order: string[] = [];
    let finishHttp = () => {};
    const markClosing = mock(() => { order.push('closing'); });
    const stopHttp = mock(() => new Promise<void>((resolve) => {
      order.push('http');
      finishHttp = resolve;
    }));
    const closeDatabase = mock(() => {
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
    expect(markClosing).toHaveBeenCalledTimes(1);
    expect(stopHttp).toHaveBeenCalledTimes(1);
    expect(closeDatabase).toHaveBeenCalledTimes(1);
  });

  it('still closes the database if closing the HTTP server fails', async () => {
    const closeDatabase = mock((): Promise<void> => Promise.resolve()).mockResolvedValue(undefined);
    const shutdown = createShutdown({
      markClosing: () => {},
      stopHttp: () => Promise.reject(new Error('HTTP close failed.')),
      closeDatabase,
    });

    await expectFailure(shutdown(), 'HTTP close failed.');
    expect(closeDatabase).toHaveBeenCalledTimes(1);
  });

  it.each(['http', 'database'])('bounds shutdown when %s does not finish', async (stage) => {
    jest.useFakeTimers();
    const pending = () => new Promise<void>(() => {});
    const shutdown = createShutdown({
      markClosing: () => {},
      stopHttp: stage === 'http' ? pending : () => Promise.resolve(),
      closeDatabase: stage === 'database' ? pending : () => Promise.resolve(),
    });

    const rejection = expectFailure(shutdown(), 'Operation timed out.');
    jest.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS);
    await rejection;
    expect(jest.getTimerCount()).toBe(0);
  });
});
