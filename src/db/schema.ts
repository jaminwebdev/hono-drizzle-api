import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 254 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'users_email_normalized',
      sql`${table.email} <> '' and ${table.email} = lower(btrim(${table.email}))`,
    ),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_last_seen_at_idx').on(table.lastSeenAt),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    type: text('type', {
      enum: ['checking', 'savings', 'cash', 'credit', 'investment'],
    }).notNull(),
    currency: varchar('currency', {
      length: 3,
      enum: ['USD', 'EUR', 'GBP'],
    })
      .default('USD')
      .notNull(),
    openingBalance: numeric('opening_balance', { precision: 18, scale: 2 })
      .default('0.00')
      .notNull(),
    isArchived: boolean('is_archived').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('accounts_user_id_idx').on(table.userId),
    unique('accounts_user_id_id_unique').on(table.userId, table.id),
    check(
      'accounts_name_trimmed',
      sql`${table.name} <> '' and ${table.name} = btrim(${table.name})`,
    ),
    check(
      'accounts_type_supported',
      sql`${table.type} in ('checking', 'savings', 'cash', 'credit', 'investment')`,
    ),
    check(
      'accounts_currency_supported',
      sql`${table.currency} in ('USD', 'EUR', 'GBP')`,
    ),
    check(
      'accounts_opening_balance_finite',
      sql`${table.openingBalance} <> 'NaN'::numeric`,
    ),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id').notNull(),
    amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
    description: varchar('description', { length: 2000 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: 'transactions_user_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('restrict'),
    check(
      'transactions_amount_valid',
      sql`${table.amount} <> 0 and ${table.amount} <> 'NaN'::numeric`,
    ),
    check('transactions_version_positive', sql`${table.version} > 0`),
    index('transactions_user_account_occurred_idx').on(
      table.userId,
      table.accountId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index('transactions_user_occurred_idx').on(
      table.userId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const transactionHistory = pgTable(
  'transaction_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // No transaction foreign key: history must survive removal of the current row.
    transactionId: uuid('transaction_id').notNull(),
    accountId: uuid('account_id').notNull(),
    version: integer('version').notNull(),
    operation: text('operation', {
      enum: ['create', 'update', 'delete'],
    }).notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    requestId: uuid('request_id').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'transaction_history_user_account_fk',
      columns: [table.userId, table.accountId],
      foreignColumns: [accounts.userId, accounts.id],
    }).onDelete('restrict'),
    unique('transaction_history_transaction_version_unique').on(
      table.transactionId,
      table.version,
    ),
    check('transaction_history_version_positive', sql`${table.version} > 0`),
    check(
      'transaction_history_operation_supported',
      sql`${table.operation} in ('create', 'update', 'delete')`,
    ),
    check(
      'transaction_history_snapshot_object',
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
    ),
    index('transaction_history_user_transaction_version_idx').on(
      table.userId,
      table.transactionId,
      table.version.desc(),
    ),
    index('transaction_history_user_account_idx').on(
      table.userId,
      table.accountId,
    ),
  ],
);
