import { sValidator } from '@hono/standard-validator';
import { and, eq, sql } from 'drizzle-orm';
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
  routes.use(
    '*',
    sValidator('query', v.strictObject({}), (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'This endpoint accepts no query fields.',
        );
      }
    }),
  );

  routes.post(
    '/',
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
    '/:id',
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
  return routes;
}
