import type { Context } from 'hono';
import { z } from 'zod';
import { ApiError, type AppEnv } from './http.js';

export function validate<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Request values are invalid.', result.error.issues.map((issue) => ({
      path: issue.path.length ? issue.path.join('.') : '$',
      // Schema messages may contain submitted values. Use controlled descriptions.
      message: issue.code === 'unrecognized_keys' ? 'Unexpected fields are not allowed.' : 'Invalid value.',
    })));
  }
  return result.data;
}

export async function readJson<T extends z.ZodType>(c: Context<AppEnv>, schema: T): Promise<z.output<T>> {
  if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') ?? '')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
  }
  let input: unknown;
  try { input = await c.req.json<unknown>(); } catch {
    throw new ApiError(400, 'INVALID_JSON', 'Request body must contain valid JSON.');
  }
  return validate(schema, input);
}
