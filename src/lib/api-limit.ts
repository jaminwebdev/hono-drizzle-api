import { createMiddleware } from 'hono/factory';
import { ApiError, type AppEnv } from './http.js';

export const API_REQUEST_LIMIT = 120;
const WINDOW_MS = 60_000;

// This single-owner demo shares one request budget per running API process.
export function apiLimit() {
  let windowStarted = Date.now();
  let requests = 0;
  return createMiddleware<AppEnv>(async (c, next) => {
    const now = Date.now();
    if (now - windowStarted >= WINDOW_MS) {
      windowStarted = now;
      requests = 0;
    }
    if (++requests > API_REQUEST_LIMIT) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((windowStarted + WINDOW_MS - now) / 1000))));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many API requests. Try again shortly.');
    }
    await next();
  });
}
