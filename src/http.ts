import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { methodNotAllowed } from 'hono/method-not-allowed';
import { secureHeaders } from 'hono/secure-headers';
import type { ClientErrorStatusCode, ServerErrorStatusCode } from 'hono/utils/http-status';

export type HttpEnv = { Variables: { requestId: string } };
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

export function installHttp(app: Hono<HttpEnv>) {
  app.use(secureHeaders({ strictTransportSecurity: false }));
  app.use(async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    c.header('Cache-Control', 'no-store');
    if (new TextEncoder().encode(c.req.url).byteLength > 8192) {
      return errorResponse(c, 414, 'URI_TOO_LONG', 'The request URL must be at most 8 KiB.');
    }
    await next();
  });
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
