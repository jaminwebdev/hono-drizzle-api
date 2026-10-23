import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { withTimeout } from './lib/with-timeout.js';
import { ApiError, errorResponse, type AppEnv } from './lib/http.js';
import { demoOwner, type FindOwner } from './lib/demo-owner.js';

export const READINESS_TIMEOUT_MS = 3_000;
export const MAX_BODY_BYTES = 64 * 1024;
export interface RequestLog {
  requestId: string; method: string; path: string; status: number; durationMs: number;
}

interface AppDependencies {
  checkDatabase?: () => Promise<void>;
  isShuttingDown?: () => boolean;
  corsOrigins?: string[];
  logRequest?: (entry: RequestLog) => void;
  apiRoutes?: Hono<AppEnv>;
  findOwner?: FindOwner;
}

export function createApp({
  checkDatabase, isShuttingDown = () => false, corsOrigins = [],
  logRequest = (entry) => { console.info(JSON.stringify(entry)); }, apiRoutes, findOwner,
}: AppDependencies = {}) {
  const app = new Hono<AppEnv>();
  // Generate our own correlation ID; do not echo caller-controlled header contents.
  app.use('*', requestId({ headerName: '' }));
  app.use('*', async (c, next) => {
    c.header('X-Request-Id', c.get('requestId'));
    c.header('Cache-Control', 'no-store');
    const started = performance.now();
    await next();
    // Log the route template. Unknown paths can contain private caller-supplied values.
    const path = c.req.routePath?.includes('*') ? '[unmatched]' : c.req.routePath;
    logRequest({ requestId: c.get('requestId'), method: c.req.method,
      path: path || '[unmatched]', status: c.res.status,
      durationMs: Math.round(performance.now() - started) });
  });
  app.use('*', secureHeaders());
  if (corsOrigins.length) app.use('*', cors({
    origin: corsOrigins, allowMethods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type'], exposeHeaders: ['X-Request-Id', 'Location'], credentials: false,
  }));
  app.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: () => {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 64 KiB.');
  } }));
  app.onError((error, c) => errorResponse(c, error instanceof ApiError ? error :
    new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.')));

  app.get('/health/live', (c) => c.json({ data: { status: 'ok' } }));
  app.get('/health/ready', async (c) => {
    try {
      if (isShuttingDown() || !checkDatabase) throw new Error('Not ready.');
      await withTimeout(checkDatabase, READINESS_TIMEOUT_MS);
      if (isShuttingDown()) throw new Error('Shutting down.');
      return c.json({ data: { status: 'ready' } });
    } catch {
      return errorResponse(c, new ApiError(503, 'SERVICE_UNAVAILABLE', 'Service is not ready.'));
    }
  });

  // Feature routes arrive in Gate 9. Their owner context is shared here.
  if (apiRoutes) {
    app.use('/api/v1/*', demoOwner(findOwner ?? (() => Promise.resolve(false))));
    app.route('/api/v1', apiRoutes);
  }
  app.notFound((c) => errorResponse(c, new ApiError(404, 'NOT_FOUND', 'Route not found.')));
  return app;
}
