import { sValidator } from '@hono/standard-validator';
import { and, asc, count, eq, ilike, sql } from 'drizzle-orm';
import { createSelectSchema } from 'drizzle-orm/valibot';
import { Hono } from 'hono';
import * as v from 'valibot';
import type { Config } from '../config';
import type { Database } from '../db/client';
import { accounts } from '../db/schema';
import { ApiError, requireJson } from '../http';
import { requireSession, type SessionEnv } from '../session';

const accountFields = createSelectSchema(accounts, {
  name: (schema) => v.pipe(v.string(), v.trim(), schema, v.minLength(1)),
  openingBalance: (schema) =>
    v.pipe(
      schema,
      v.regex(/^-?(?:0|[1-9]\d{0,15})\.\d{2}$/),
      v.check((value) => value !== '-0.00' && value === value.trim()),
    ),
});
const createFields = v.pick(accountFields, [
  'name',
  'type',
  'currency',
  'openingBalance',
]);
export const createAccountSchema = v.strictObject({
  ...createFields.entries,
  currency: v.optional(createFields.entries.currency, 'USD'),
  openingBalance: v.optional(createFields.entries.openingBalance, '0.00'),
});
export const accountIdSchema = v.strictObject({ id: accountFields.entries.id });
const patchFields = v.partial(v.pick(accountFields, ['name', 'isArchived']));
export const patchAccountSchema = v.pipe(
  v.strictObject(patchFields.entries),
  v.check((value) => Object.keys(value).length > 0),
);

const positiveQueryInteger = v.pipe(
  v.string(),
  v.regex(/^[1-9]\d{0,4}$/),
  v.check((value) => value === value.trim()),
  v.transform(Number),
  v.maxValue(10_001),
);
export const accountListSchema = v.pipe(
  v.strictObject({
    q: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(100)), ''),
    archived: v.optional(
      v.pipe(
        v.picklist(['true', 'false']),
        v.transform((value) => value === 'true'),
      ),
    ),
    page: v.optional(positiveQueryInteger, '1'),
    limit: v.optional(v.pipe(positiveQueryInteger, v.maxValue(100)), '25'),
  }),
  v.check(({ page, limit }) => (page - 1) * limit <= 10_000),
);

const accountSelection = {
  id: accounts.id,
  name: accounts.name,
  type: accounts.type,
  currency: accounts.currency,
  // SQL text preserves two decimal places without converting money to a number.
  openingBalance: sql<string>`${accounts.openingBalance}::text`,
  isArchived: accounts.isArchived,
  createdAt: accounts.createdAt,
  updatedAt: accounts.updatedAt,
};

export function createAccountRoutes(
  database: Database,
  mode: Config['APP_ENV'],
) {
  const routes = new Hono<SessionEnv>();
  routes.use('*', requireSession(database, mode));
  routes.post(
    '/',
    sValidator('query', v.strictObject({}), (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'This endpoint accepts no query fields.',
        );
      }
    }),
    requireJson,
    sValidator('json', createAccountSchema, (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'Provide an account name, a supported type and currency, and an opening balance with two decimal places.',
        );
      }
    }),
    async (c) => {
      const input = c.req.valid('json');
      const [account] = await database
        .insert(accounts)
        .values({ ...input, userId: c.get('session').user.id })
        .returning(accountSelection);
      if (!account) throw new Error('Account creation returned no account.');
      c.header('Location', `/api/v1/accounts/${account.id}`);
      return c.json({ data: account }, 201);
    },
  );

  routes.get(
    '/',
    sValidator('query', accountListSchema, (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'Use only q, archived=true or false, and positive page/limit values. Limit is at most 100 and pages may skip at most 10000 rows.',
        );
      }
    }),
    async (c) => {
      const { q, archived, page, limit } = c.req.valid('query');
      // Escape LIKE's wildcard and escape characters so q is a literal substring.
      const escaped = q.replace(/[\\%_]/g, '\\$&');
      const conditions = and(
        eq(accounts.userId, c.get('session').user.id),
        q ? ilike(accounts.name, `%${escaped}%`) : undefined,
        archived === undefined ? undefined : eq(accounts.isArchived, archived),
      );
      const data = await database
        .select(accountSelection)
        .from(accounts)
        .where(conditions)
        .orderBy(asc(accounts.name), asc(accounts.id))
        .limit(limit)
        .offset((page - 1) * limit);
      const [matching] = await database
        .select({ total: count() })
        .from(accounts)
        .where(conditions);
      if (!matching) throw new Error('Account count returned no result.');
      return c.json({
        data,
        pagination: { page, limit, total: matching.total },
      });
    },
  );

  routes.get(
    '/:id',
    sValidator('query', v.strictObject({}), (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'This endpoint accepts no query fields.',
        );
      }
    }),
    sValidator('param', accountIdSchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid account ID.');
      }
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const [account] = await database
        .select(accountSelection)
        .from(accounts)
        .where(
          and(
            eq(accounts.id, id),
            eq(accounts.userId, c.get('session').user.id),
          ),
        )
        .limit(1);
      if (!account) {
        throw new ApiError(404, 'NOT_FOUND', 'The account was not found.');
      }
      return c.json({ data: account });
    },
  );
  routes.patch(
    '/:id',
    sValidator('query', v.strictObject({}), (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'This endpoint accepts no query fields.',
        );
      }
    }),
    sValidator('param', accountIdSchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, 'INVALID_INPUT', 'Provide a valid account ID.');
      }
    }),
    requireJson,
    sValidator('json', patchAccountSchema, (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'Provide only a nonempty account name or a boolean isArchived, or both.',
        );
      }
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const patch = c.req.valid('json');
      const owned = and(
        eq(accounts.id, id),
        eq(accounts.userId, c.get('session').user.id),
      );
      const [account] = await database
        .update(accounts)
        .set({ ...patch, updatedAt: new Date(Date.now()) })
        .where(owned)
        .returning(accountSelection);
      if (!account) {
        throw new ApiError(404, 'NOT_FOUND', 'The account was not found.');
      }
      return c.json({ data: account });
    },
  );
  return routes;
}
