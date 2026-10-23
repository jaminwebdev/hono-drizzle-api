import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
  // Later finance tables reference this pair to enforce matching owners.
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
