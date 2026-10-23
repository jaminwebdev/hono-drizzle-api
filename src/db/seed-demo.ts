import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import { seed } from 'drizzle-seed';
import {
  DEMO_OWNER_ID, demoAccounts, demoBudgets, demoCategories, demoLinks,
  demoTags, demoTransactions, demoUser,
} from './demo-data.js';
import { accounts, budgets, categories, tags, transactions, transactionTags, users } from './schema.js';

export function requireLocalSeed(environment: unknown) {
  if (environment !== 'local') throw new Error('Demo seeding is allowed only with APP_ENV=local.');
}

export async function seedDemo(db: NodePgDatabase, environment: unknown) {
  // Check before opening a transaction or issuing any database query.
  requireLocalSeed(environment);
  return db.transaction(async (tx) => {
    // Serialize two seed commands so the second sees the first completed result.
    await tx.execute(sql`select pg_advisory_xact_lock(734207)`);
    const groups = [
      { table: accounts, rows: demoAccounts }, { table: categories, rows: demoCategories },
      { table: tags, rows: demoTags }, { table: transactions, rows: demoTransactions },
      { table: budgets, rows: demoBudgets },
    ];
    const existingUser = await tx.select().from(users).where(eq(users.id, DEMO_OWNER_ID));
    let present = existingUser.length;
    let expected = 1;
    let wrongOwner = false;
    for (const { table, rows } of groups) {
      const existing = await tx.select({ ownerId: table.ownerId }).from(table)
        .where(inArray(table.id, rows.map((row) => row.id)));
      present += existing.length;
      expected += rows.length;
      wrongOwner ||= existing.some((row) => row.ownerId !== DEMO_OWNER_ID);
    }
    for (const link of demoLinks) {
      const existing = await tx.select({ ownerId: transactionTags.ownerId }).from(transactionTags).where(and(
        eq(transactionTags.ownerId, DEMO_OWNER_ID), eq(transactionTags.transactionId, link.transactionId),
        eq(transactionTags.tagId, link.tagId),
      ));
      present += existing.length;
      expected++;
    }
    if (wrongOwner || (present > 0 && present !== expected)) {
      throw new Error('Demo fixtures are incomplete or conflicting. No data was changed. Inspect them in Studio before retrying.');
    }
    if (present === expected) return 'unchanged' as const;

    // Seed fixed reference rows through drizzle-seed. Defaults keep every related ID stable.
    async function generateReference(table: PgTable, row: Record<string, unknown>) {
      await seed(tx, { fixture: table }, { count: 1, seed: 202601, version: '2' }).refine((f) => ({
        fixture: { columns: Object.fromEntries(Object.entries(row).map(([column, value]) =>
          [column, f.default({ defaultValue: value })])) },
      }));
    }
    await generateReference(users, demoUser);
    for (const row of demoAccounts) await generateReference(accounts, row);
    for (const row of demoCategories) await generateReference(categories, row);
    for (const row of demoTags) await generateReference(tags, row);
    // Explicit financial rows keep amounts, dates, and tag associations easy to review.
    await tx.insert(transactions).values(demoTransactions);
    await tx.insert(transactionTags).values(demoLinks);
    await tx.insert(budgets).values(demoBudgets);
    return 'created' as const;
  }).catch((error: unknown) => {
    // Drizzle wraps driver failures; PostgreSQL's code is on the underlying cause.
    const cause = error instanceof Error ? error.cause : undefined;
    const driverError = cause instanceof Error ? cause : error;
    if (driverError instanceof Error && 'code' in driverError && driverError.code === '23505') {
      throw new Error('Demo fixtures conflict with existing data. No seed rows were committed. Inspect them in Studio before retrying.');
    }
    throw error;
  });
}
