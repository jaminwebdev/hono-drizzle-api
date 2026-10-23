import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  ...timestamps(),
}, (table) => [
  unique('users_email_unique').on(table.email),
  check('users_email_normalized', sql`${table.email} = lower(btrim(${table.email}))`),
  check('users_email_valid', sql`char_length(${table.email}) between 3 and 254
    and ${table.email} ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'`),
]);

export const accounts = pgTable('accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  type: text('type', { enum: ['checking', 'savings', 'cash'] }).notNull(),
  currency: text('currency', { enum: ['USD'] }).default('USD').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps(),
}, (table) => [
  // Finance tables reference this pair to enforce matching owners.
  unique('accounts_owner_id_id_unique').on(table.ownerId, table.id),
  uniqueIndex('accounts_owner_name_unique').on(table.ownerId, sql`lower(${table.name})`),
  check('accounts_name_valid', sql`char_length(${table.name}) between 1 and 100
    and ${table.name} = btrim(${table.name}) and ${table.name} !~ '[[:cntrl:]]'`),
  check('accounts_type_valid', sql`${table.type} in ('checking', 'savings', 'cash')`),
  check('accounts_currency_usd', sql`${table.currency} = 'USD'`),
]);

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  ...timestamps(),
}, (table) => [
  unique('categories_owner_id_id_unique').on(table.ownerId, table.id),
  uniqueIndex('categories_owner_name_unique').on(table.ownerId, sql`lower(${table.name})`),
  check('categories_name_valid', sql`char_length(${table.name}) between 1 and 100
    and ${table.name} = btrim(${table.name}) and ${table.name} !~ '[[:cntrl:]]'`),
]);

export const tags = pgTable('tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  ...timestamps(),
}, (table) => [
  unique('tags_owner_id_id_unique').on(table.ownerId, table.id),
  uniqueIndex('tags_owner_name_unique').on(table.ownerId, sql`lower(${table.name})`),
  check('tags_name_valid', sql`char_length(${table.name}) between 1 and 100
    and ${table.name} = btrim(${table.name}) and ${table.name} !~ '[[:cntrl:]]'`),
]);


export const transactions = pgTable('transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  accountId: uuid('account_id').notNull(),
  categoryId: uuid('category_id'),
  // A fixed numeric scale rounds before CHECK runs. Keep fractions intact to reject them.
  amount: numeric('amount').notNull(),
  description: text('description').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  reversalOfId: uuid('reversal_of_id'),
}, (table) => [
  unique('transactions_owner_id_id_unique').on(table.ownerId, table.id),
  unique('transactions_reversal_of_id_unique').on(table.reversalOfId),
  foreignKey({
    name: 'transactions_account_owner_fk',
    columns: [table.ownerId, table.accountId],
    foreignColumns: [accounts.ownerId, accounts.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'transactions_category_owner_fk',
    columns: [table.ownerId, table.categoryId],
    foreignColumns: [categories.ownerId, categories.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'transactions_reversal_owner_fk',
    columns: [table.ownerId, table.reversalOfId],
    foreignColumns: [table.ownerId, table.id],
  }).onDelete('restrict'),
  check('transactions_amount_valid', sql`${table.amount} <> 0
    and abs(${table.amount}) < 1000000000000
    and ${table.amount} = trunc(${table.amount}, 2)`),
  check('transactions_description_valid', sql`char_length(${table.description}) between 1 and 500
    and ${table.description} = btrim(${table.description})
    and ${table.description} !~ '[[:cntrl:]]'`),
  check('transactions_occurred_at_finite', sql`isfinite(${table.occurredAt})`),
  check('transactions_reversal_not_self', sql`${table.reversalOfId} is null or ${table.reversalOfId} <> ${table.id}`),
  index('transactions_owner_date_id_idx').on(table.ownerId, table.occurredAt.desc(), table.id.desc()),
  index('transactions_owner_account_date_id_idx').on(table.ownerId, table.accountId, table.occurredAt.desc(), table.id.desc()),
  index('transactions_owner_category_date_id_idx').on(table.ownerId, table.categoryId, table.occurredAt.desc(), table.id.desc()),
]);

export const transactionTags = pgTable('transaction_tags', {
  ownerId: uuid('owner_id').notNull(),
  transactionId: uuid('transaction_id').notNull(),
  tagId: uuid('tag_id').notNull(),
}, (table) => [
  primaryKey({ name: 'transaction_tags_pk', columns: [table.ownerId, table.transactionId, table.tagId] }),
  foreignKey({
    name: 'transaction_tags_transaction_owner_fk',
    columns: [table.ownerId, table.transactionId],
    foreignColumns: [transactions.ownerId, transactions.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'transaction_tags_tag_owner_fk',
    columns: [table.ownerId, table.tagId],
    foreignColumns: [tags.ownerId, tags.id],
  }).onDelete('restrict'),
  index('transaction_tags_owner_tag_transaction_idx').on(table.ownerId, table.tagId, table.transactionId),
]);

export const budgets = pgTable('budgets', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  categoryId: uuid('category_id').notNull(),
  month: date('month', { mode: 'string' }).notNull(),
  limitAmount: numeric('limit_amount').notNull(),
  ...timestamps(),
}, (table) => [
  unique('budgets_owner_category_month_unique').on(table.ownerId, table.categoryId, table.month),
  foreignKey({
    name: 'budgets_category_owner_fk',
    columns: [table.ownerId, table.categoryId],
    foreignColumns: [categories.ownerId, categories.id],
  }).onDelete('restrict'),
  check('budgets_month_valid', sql`isfinite(${table.month}) and extract(day from ${table.month}) = 1`),
  check('budgets_limit_amount_valid', sql`${table.limitAmount} > 0
    and ${table.limitAmount} < 1000000000000
    and ${table.limitAmount} = trunc(${table.limitAmount}, 2)`),
  index('budgets_owner_month_id_idx').on(table.ownerId, table.month, table.id),
]);
