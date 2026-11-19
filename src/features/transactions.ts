import { sValidator } from '@hono/standard-validator';
import { and, count, desc, eq, sql } from 'drizzle-orm';
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

const patchFields = v.partial(
  v.pick(transactionFields, ['amount', 'description', 'occurredAt']),
);
export const patchTransactionSchema = v.pipe(
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
const historyQuerySchema = v.pipe(
  v.strictObject({
    page: v.optional(positiveQueryInteger, '1'),
    limit: v.optional(v.pipe(positiveQueryInteger, v.maxValue(100)), '25'),
  }),
  v.check(({ page, limit }) => (page - 1) * limit <= 10_000),
);
const noQuery = sValidator('query', v.strictObject({}), (result) => {
  if (!result.success) {
    throw new ApiError(
      400,
      'INVALID_INPUT',
      'This endpoint accepts no query fields.',
    );
  }
});
const validTransactionId = sValidator(
  'param',
  transactionIdSchema,
  (result) => {
    if (!result.success) {
      throw new ApiError(
        400,
        'INVALID_INPUT',
        'Provide a valid transaction ID.',
      );
    }
  },
);

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
  routes.post(
    '/',
    noQuery,
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

  routes.get('/:id', noQuery, validTransactionId, async (c) => {
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
  });
  routes.patch(
    '/:id',
    noQuery,
    validTransactionId,
    requireJson,
    sValidator('json', patchTransactionSchema, (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'Provide at least one valid amount, description, or occurredAt field.',
        );
      }
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const input = c.req.valid('json');
      const userId = c.get('session').user.id;
      const transaction = await database.transaction(async (tx) => {
        const owned = and(
          eq(transactions.id, id),
          eq(transactions.userId, userId),
        );
        const [current] = await tx
          .select(transactionSelection)
          .from(transactions)
          .where(owned)
          .for('update');
        if (!current) {
          throw new ApiError(
            404,
            'NOT_FOUND',
            'The transaction was not found.',
          );
        }
        // Check ownership before reporting version errors to avoid revealing foreign rows.
        const expected = c.req.header('If-Match');
        if (expected === undefined) {
          throw new ApiError(
            428,
            'PRECONDITION_REQUIRED',
            'Provide the transaction ETag in If-Match.',
          );
        }
        if (
          !/^"[1-9]\d{0,9}"$/.test(expected) ||
          expected !== expected.trim() ||
          Number(expected.slice(1, -1)) > 2_147_483_647
        ) {
          throw new ApiError(
            400,
            'INVALID_INPUT',
            'If-Match must contain one quoted positive transaction version.',
          );
        }
        if (Number(expected.slice(1, -1)) !== current.version) {
          throw new ApiError(
            412,
            'VERSION_MISMATCH',
            'The transaction has changed. Read it again before updating.',
          );
        }
        const [account] = await tx
          .select({
            id: accounts.id,
            name: accounts.name,
            currency: accounts.currency,
          })
          .from(accounts)
          .where(
            and(
              eq(accounts.id, current.accountId),
              eq(accounts.userId, userId),
            ),
          );
        if (!account) throw new Error('Transaction account was not found.');
        const [updated] = await tx
          .update(transactions)
          .set({
            ...input,
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(owned)
          .returning(transactionSelection);
        if (!updated)
          throw new Error('Transaction update returned no transaction.');
        await tx.insert(transactionHistory).values({
          userId,
          transactionId: id,
          accountId: current.accountId,
          version: updated.version,
          operation: 'update',
          requestId: c.get('requestId'),
          snapshot: { ...updated, account },
        });
        return updated;
      });
      c.header('ETag', `"${transaction.version}"`);
      return c.json({ data: transaction });
    },
  );

  routes.get(
    '/:id/history',
    validTransactionId,
    sValidator('query', historyQuerySchema, (result) => {
      if (!result.success) {
        throw new ApiError(
          400,
          'INVALID_INPUT',
          'Use positive page/limit values. Limit is at most 100 and pages may skip at most 10000 rows.',
        );
      }
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { page, limit } = c.req.valid('query');
      const userId = c.get('session').user.id;
      const ownedHistory = and(
        eq(transactionHistory.transactionId, id),
        eq(transactionHistory.userId, userId),
      );
      const [matching] = await database
        .select({ total: count() })
        .from(transactionHistory)
        .where(ownedHistory);
      if (!matching) throw new Error('History count returned no result.');
      if (matching.total === 0) {
        const [current] = await database
          .select({ id: transactions.id })
          .from(transactions)
          .where(and(eq(transactions.id, id), eq(transactions.userId, userId)))
          .limit(1);
        if (!current)
          throw new ApiError(
            404,
            'NOT_FOUND',
            'The transaction was not found.',
          );
      }
      const data = await database
        .select({
          id: transactionHistory.id,
          transactionId: transactionHistory.transactionId,
          accountId: transactionHistory.accountId,
          version: transactionHistory.version,
          operation: transactionHistory.operation,
          snapshot: transactionHistory.snapshot,
          recordedAt: transactionHistory.recordedAt,
          requestId: transactionHistory.requestId,
        })
        .from(transactionHistory)
        .where(ownedHistory)
        .orderBy(desc(transactionHistory.version))
        .limit(limit)
        .offset((page - 1) * limit);
      return c.json({
        data,
        pagination: { page, limit, total: matching.total },
      });
    },
  );
  return routes;
}
