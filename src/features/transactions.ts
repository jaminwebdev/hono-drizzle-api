import { sValidator } from '@hono/standard-validator';
import { and, eq, sql } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema } from 'drizzle-orm/valibot';
import { Hono } from 'hono';
import * as v from 'valibot';
import type { Config } from '../config';
import type { Database } from '../db/client';
import { accounts, transactionHistory, transactions } from '../db/schema';
import { ApiError, requireJson } from '../http';
import { requireSession, type SessionEnv } from '../session';

const occurredAtSchema = v.pipe(
  v.string(),
  v.isoDate(),
  v.check((value) => {
    const day = new Date(`${value}T00:00:00Z`);
    return (
      value.slice(0, 4) !== '0000' &&
      Number.isFinite(day.getTime()) &&
      day.toISOString().slice(0, 10) === value
    );
  }),
);
const transactionFields = createInsertSchema(transactions, {
  amount: (schema) =>
    v.pipe(
      schema,
      v.regex(/^-?(?:0|[1-9]\d{0,15})\.\d{2}$/),
      v.check(
        (value) =>
          value !== '0.00' && value !== '-0.00' && value === value.trim(),
      ),
    ),
  occurredAt: occurredAtSchema,
});
const createFields = v.pick(transactionFields, [
  'accountId',
  'amount',
  'description',
  'occurredAt',
]);
export const createTransactionSchema = v.strictObject(createFields.entries);
const transactionIdSchema = v.strictObject({
  id: createSelectSchema(transactions).entries.id,
});

const transactionSelection = {
  id: transactions.id,
  accountId: transactions.accountId,
  amount: sql<string>`${transactions.amount}::text`,
  description: transactions.description,
  occurredAt: transactions.occurredAt,
  version: transactions.version,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
};

export function createTransactionRoutes(
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
    sValidator('json', createTransactionSchema, (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'Provide an account ID, a nonzero amount as a two-decimal string, an optional description, and a valid calendar date in YYYY-MM-DD format.',
        );
      }
    }),
    async (c) => {
      const input = c.req.valid('json');
      const userId = c.get('session').user.id;
      const transaction = await database.transaction(async (tx) => {
        const [account] = await tx
          .select({
            id: accounts.id,
            name: accounts.name,
            currency: accounts.currency,
            isArchived: accounts.isArchived,
          })
          .from(accounts)
          .where(
            and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)),
          )
          .for('update');
        if (!account) {
          throw new ApiError(404, 'NOT_FOUND', 'The account was not found.');
        }
        if (account.isArchived) {
          throw new ApiError(
            409,
            'ACCOUNT_ARCHIVED',
            'The account is archived.',
          );
        }
        const [created] = await tx
          .insert(transactions)
          .values({ ...input, userId })
          .returning(transactionSelection);
        if (!created)
          throw new Error('Transaction creation returned no transaction.');
        await tx.insert(transactionHistory).values({
          userId,
          transactionId: created.id,
          accountId: account.id,
          version: created.version,
          operation: 'create',
          requestId: c.get('requestId'),
          snapshot: {
            ...created,
            account: {
              id: account.id,
              name: account.name,
              currency: account.currency,
            },
          },
        });
        return created;
      });
      c.header('Location', `/api/v1/transactions/${transaction.id}`);
      c.header('ETag', `"${transaction.version}"`);
      return c.json({ data: transaction }, 201);
    },
  );

  routes.get(
    '/:id',
    sValidator('param', transactionIdSchema, (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'Provide a valid transaction ID.',
        );
      }
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const [transaction] = await database
        .select(transactionSelection)
        .from(transactions)
        .where(
          and(
            eq(transactions.id, id),
            eq(transactions.userId, c.get('session').user.id),
          ),
        )
        .limit(1);
      if (!transaction) {
        throw new ApiError(404, 'NOT_FOUND', 'The transaction was not found.');
      }
      c.header('ETag', `"${transaction.version}"`);
      return c.json({ data: transaction });
    },
  );
  return routes;
}
