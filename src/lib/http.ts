import type { Context } from 'hono';

export type AppEnv = { Variables: { requestId: string; ownerId: string } };
export type ErrorStatus = 400 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503;
export interface ValidationDetail { path: string; message: string }

export class ApiError extends Error {
  constructor(
    public readonly status: ErrorStatus,
    public readonly code: string,
    message: string,
    public readonly details?: ValidationDetail[],
  ) { super(message); }
}

export function errorResponse(c: Context<AppEnv>, error: ApiError) {
  return c.json({ error: {
    code: error.code, message: error.message, status: error.status,
    requestId: c.get('requestId'), ...(error.details ? { details: error.details } : {}),
  } }, error.status);
}
