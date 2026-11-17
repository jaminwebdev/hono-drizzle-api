import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
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
