import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { methodNotAllowed } from 'hono/method-not-allowed';
import { routePath } from 'hono/route';
import { secureHeaders } from 'hono/secure-headers';
import type { ClientErrorStatusCode, ServerErrorStatusCode } from 'hono/utils/http-status';
import type { Config } from './config';

export type HttpEnv = { Variables: { requestId: string } };
export type HttpSettings = Pick<Config, 'API_ORIGIN' | 'CORS_ORIGINS'>;
type ErrorStatus = ClientErrorStatusCode | ServerErrorStatusCode;

export class ApiError extends Error {
  constructor(readonly status: ErrorStatus, readonly code: string, message: string) {
    super(message);
  }
}

export function errorResponse(c: Context<HttpEnv>, status: ErrorStatus, code: string, message: string) {
  return c.json({
    error: { code, message, status, requestId: c.get('requestId'), timestamp: new Date().toISOString() },
  }, status);
}

export function installHttp(app: Hono<HttpEnv>, settings: HttpSettings) {
  const allowedOrigins = [settings.API_ORIGIN, ...settings.CORS_ORIGINS];
  app.use(secureHeaders({ strictTransportSecurity: false }));
  app.use(async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    c.header('Cache-Control', 'no-store');
    const started = performance.now();
    await next();
    console.log(JSON.stringify({
      requestId,
      method: c.req.method,
      route: routePath(c, -1) || null,
      status: c.res.status,
      elapsedMs: Math.round(performance.now() - started),
    }));
  });
  app.use(async (c, next) => {
    if (new TextEncoder().encode(c.req.url).byteLength > 8192) {
      return errorResponse(c, 414, 'URI_TOO_LONG', 'The request URL must be at most 8 KiB.');
    }
    await next();
  });
  app.use(async (c, next) => {
    const origin = c.req.header('Origin');
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method);
    if (unsafe && (!origin || !allowedOrigins.includes(origin))) {
      return errorResponse(c, 403, 'ORIGIN_REJECTED', 'The request origin is not allowed.');
    }
    await next();
  });
  if (settings.CORS_ORIGINS.length > 0) {
    app.use(cors({
      origin: settings.CORS_ORIGINS,
      credentials: true,
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['Content-Type', 'X-CSRF-Token', 'If-Match'],
      exposeHeaders: ['ETag', 'Location', 'X-Request-Id'],
    }));
  }
  app.use(bodyLimit({
    maxSize: 64 * 1024,
    onError: () => {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body must be at most 64 KiB.');
    },
  }));
  app.use(methodNotAllowed({
    app,
    onMethodNotAllowed: (c, methods) => {
      c.header('Allow', methods.join(', '));
      return errorResponse(c, 405, 'METHOD_NOT_ALLOWED', 'This method is not supported for this URL.');
    },
  }));
  app.notFound((c) => errorResponse(c, 404, 'NOT_FOUND', 'The requested resource was not found.'));
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.status, error.code, error.message);
    return errorResponse(c, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  });
}

export async function readJson(c: Context<HttpEnv>): Promise<unknown> {
  const mediaType = c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
  }

  try {
    return await c.req.json<unknown>();
  } catch {
    throw new ApiError(400, 'INVALID_INPUT', 'The body must contain valid JSON.');
  }
}
