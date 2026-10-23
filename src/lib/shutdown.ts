import { withTimeout } from './with-timeout.js';

export const SHUTDOWN_TIMEOUT_MS = 10_000;

interface ShutdownOptions {
  markClosing: () => void;
  stopHttp: () => Promise<void>;
  closeDatabase: () => Promise<void>;
}

export function createShutdown({ markClosing, stopHttp, closeDatabase }: ShutdownOptions) {
  let pending: Promise<void> | undefined;

  return () => {
    if (pending) return pending;
    markClosing();

    pending = withTimeout(async () => {
      try {
        await stopHttp();
      } finally {
        await closeDatabase();
      }
    }, SHUTDOWN_TIMEOUT_MS);

    return pending;
  };
}
