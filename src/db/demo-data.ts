import type { accounts, budgets, categories, tags, transactions, users, transactionTags } from './schema.js';

import { DEMO_OWNER_ID } from '../lib/demo-identity.js';
export { DEMO_OWNER_ID } from '../lib/demo-identity.js';

const id = (number: number) => `d0000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const createdAt = new Date('2026-01-01T00:00:00Z');
const timestamps = { createdAt, updatedAt: createdAt };
const owned = { ownerId: DEMO_OWNER_ID, ...timestamps };

export const demoUser = {
  id: DEMO_OWNER_ID, email: 'demo@example.test', ...timestamps,
} satisfies typeof users.$inferInsert;

export const demoAccounts = [
  { id: id(11), name: 'Checking', type: 'checking', currency: 'USD', archivedAt: null, ...owned },
  { id: id(12), name: 'Savings', type: 'savings', currency: 'USD', archivedAt: null, ...owned },
] satisfies (typeof accounts.$inferInsert)[];

export const demoCategories = [
  { id: id(21), name: 'Groceries', archivedAt: null, ...owned },
  { id: id(22), name: 'Housing', archivedAt: null, ...owned },
  { id: id(23), name: 'Transport', archivedAt: null, ...owned },
] satisfies (typeof categories.$inferInsert)[];

export const demoTags = [
  { id: id(31), name: 'Recurring', ...owned },
  { id: id(32), name: 'Essential', ...owned },
] satisfies (typeof tags.$inferInsert)[];

// Keep amounts as decimal strings. Dates stay fixed so report examples never drift.
export const demoTransactions = [
  { id: id(41), accountId: id(11), categoryId: null, amount: '2500.00', description: 'Opening checking balance', occurredAt: new Date('2026-01-01T00:00:00Z') },
  { id: id(42), accountId: id(12), categoryId: null, amount: '5000.00', description: 'Opening savings balance', occurredAt: new Date('2026-01-01T00:00:00Z') },
  { id: id(43), accountId: id(11), categoryId: null, amount: '3200.00', description: 'January salary', occurredAt: new Date('2026-01-05T09:00:00Z') },
  { id: id(44), accountId: id(11), categoryId: id(22), amount: '-1200.00', description: 'January rent', occurredAt: new Date('2026-01-02T09:00:00Z') },
  { id: id(45), accountId: id(11), categoryId: id(21), amount: '-85.40', description: 'Weekly groceries', occurredAt: new Date('2026-01-10T17:30:00Z') },
  { id: id(46), accountId: id(11), categoryId: id(23), amount: '-45.00', description: 'Monthly bus pass', occurredAt: new Date('2026-01-03T08:00:00Z') },
  { id: id(47), accountId: id(11), categoryId: id(21), amount: '5.40', description: 'Grocery refund', occurredAt: new Date('2026-01-12T12:00:00Z') },
  { id: id(48), accountId: id(11), categoryId: null, amount: '3200.00', description: 'February salary', occurredAt: new Date('2026-02-05T09:00:00Z') },
  { id: id(49), accountId: id(11), categoryId: id(22), amount: '-1200.00', description: 'February rent', occurredAt: new Date('2026-02-02T09:00:00Z') },
  { id: id(50), accountId: id(11), categoryId: id(21), amount: '-92.10', description: 'February groceries', occurredAt: new Date('2026-02-07T16:00:00Z') },
].map((entry) => ({ ...entry, ownerId: DEMO_OWNER_ID, createdAt, reversalOfId: null })) satisfies (typeof transactions.$inferInsert)[];

export const demoLinks = [
  { transactionId: id(44), tagId: id(31) },
  { transactionId: id(44), tagId: id(32) },
  { transactionId: id(45), tagId: id(32) },
  { transactionId: id(46), tagId: id(31) },
  { transactionId: id(49), tagId: id(31) },
].map((link) => ({ ...link, ownerId: DEMO_OWNER_ID })) satisfies (typeof transactionTags.$inferInsert)[];

export const demoBudgets = ['2026-01-01', '2026-02-01'].flatMap((month, index) => [
  { id: id(61 + index * 3), categoryId: id(21), month, limitAmount: '400.00', ...owned },
  { id: id(62 + index * 3), categoryId: id(22), month, limitAmount: '1200.00', ...owned },
  { id: id(63 + index * 3), categoryId: id(23), month, limitAmount: '100.00', ...owned },
]) satisfies (typeof budgets.$inferInsert)[];
