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

// Mutation schemas must list their fields explicitly. Unknown fields, including ownerId, are rejected.
export const mutationObject = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape);

const positiveInteger = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().max(Number.MAX_SAFE_INTEGER));
const paginationSchema = z.strictObject({
  page: positiveInteger.default(1), limit: positiveInteger.pipe(z.number().max(100)).default(25),
});

function singleQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

export function parsePagination(query: Record<string, string | string[] | undefined>) {
  const { page, limit } = validate(paginationSchema, {
    page: singleQueryValue(query.page), limit: singleQueryValue(query.limit),
  });
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(offset + limit + 1)) {
    throw new ApiError(422, 'VALIDATION_ERROR', 'Pagination exceeds the supported range.');
  }
  return { page, limit, offset };
}

export function parseSort<const T extends readonly [string, ...string[]]>(
  query: Record<string, string | string[] | undefined>, allowed: T, defaultSort: T[number],
) {
  return validate(z.strictObject({
    sort: z.enum(allowed).default(defaultSort), direction: z.enum(['asc', 'desc']).default('desc'),
  }), { sort: singleQueryValue(query.sort), direction: singleQueryValue(query.direction) });
}
