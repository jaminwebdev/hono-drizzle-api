import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Pool } from 'pg';
import { expectDatabaseError } from '../support/assertions.js';
import { requireTestDatabaseName, testDatabaseOptions, verifyTestDatabase } from '../support/database.js';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ownerA = id(1), ownerB = id(2);
const accountA = id(11), accountB = id(12);
const categoryA = id(21), categoryA2 = id(22), categoryB = id(23);
const tagA = id(31), tagA2 = id(32), tagB = id(33);
const occurredAt = '2026-01-15T12:00:00Z';

interface Entry {
  id: string;
  ownerId: string;
  accountId: string;
  categoryId: string | null;
  amount: string;
  description: string;
  occurredAt: string;
  reversalOfId: string | null;
}

// The runner supplies a guarded, generated database; fast checks skip this suite.
describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')('PostgreSQL financial schema', () => {
  let pool: Pool;
  let name: string;

  beforeAll(async () => {
    name = requireTestDatabaseName(process.env.TEST_DATABASE_NAME);
    pool = new Pool({ ...testDatabaseOptions(), database: name, max: 2 });
    await verifyTestDatabase(pool, name);
  });

  beforeEach(async () => {
    await verifyTestDatabase(pool, name);
    await pool.query('truncate table users cascade');
    await pool.query('insert into users (id, email) values ($1, $2), ($3, $4)',
      [ownerA, 'owner-a@example.test', ownerB, 'owner-b@example.test']);
    await pool.query("insert into accounts (id, owner_id, name, type) values ($1, $2, 'Checking', 'checking'), ($3, $4, 'Checking', 'checking')",
      [accountA, ownerA, accountB, ownerB]);
    await pool.query("insert into categories (id, owner_id, name) values ($1, $2, 'Food'), ($3, $2, 'Travel'), ($4, $5, 'Food')",
      [categoryA, ownerA, categoryA2, categoryB, ownerB]);
    await pool.query("insert into tags (id, owner_id, name) values ($1, $2, 'Recurring'), ($3, $2, 'Essential'), ($4, $5, 'Recurring')",
      [tagA, ownerA, tagA2, tagB, ownerB]);
  });

  afterAll(async () => { await pool?.end(); });

  async function insertEntry(changes: Partial<Entry> = {}) {
    const entry: Entry = {
      id: crypto.randomUUID(), ownerId: ownerA, accountId: accountA, categoryId: categoryA,
      amount: '-12.34', description: 'Groceries', occurredAt, reversalOfId: null, ...changes,
    };
    await pool.query(`insert into transactions
      (id, owner_id, account_id, category_id, amount, description, occurred_at, reversal_of_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [entry.id, entry.ownerId, entry.accountId, entry.categoryId, entry.amount,
      entry.description, entry.occurredAt, entry.reversalOfId]);
    return entry;
  }

  function insertLink(transactionId: string, tagId = tagA, ownerId = ownerA) {
    return pool.query('insert into transaction_tags (owner_id, transaction_id, tag_id) values ($1, $2, $3)',
      [ownerId, transactionId, tagId]);
  }

  async function insertBudget(changes: {
    ownerId?: string; categoryId?: string; month?: string; limitAmount?: string;
  } = {}) {
    const budget = { ownerId: ownerA, categoryId: categoryA, month: '2026-01-01', limitAmount: '100.00', ...changes };
    const result = await pool.query<{ id: string }>(`insert into budgets (owner_id, category_id, month, limit_amount)
      values ($1, $2, $3, $4) returning id`,
    [budget.ownerId, budget.categoryId, budget.month, budget.limitAmount]);
    const row = result.rows[0];
    if (!row) throw new Error('Budget fixture was not inserted.');
    return row.id;
  }

  it('requires nonzero whole-cent transaction amounts within the supported range', async () => {
    await insertEntry({ amount: '999999999999.99' });
    await insertEntry({ amount: '-999999999999.99' });
    for (const amount of ['0', '1.239', '-1.239', '1000000000000', '-1000000000000']) {
      await expectDatabaseError(insertEntry({ amount }), '23514');
    }
  });

  it('prevents transactions from using accounts or categories belonging to another owner', async () => {
    await expectDatabaseError(insertEntry({ accountId: accountB }), '23503');
    await expectDatabaseError(insertEntry({ categoryId: categoryB }), '23503');
  });

  it('allows only one competing reversal insert to succeed', async () => {
    const original = await insertEntry();
    const results = await Promise.allSettled([
      insertEntry({ amount: '12.34', reversalOfId: original.id }),
      insertEntry({ amount: '12.34', reversalOfId: original.id }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect((failure?.reason as { code?: string } | undefined)?.code).toBe('23505');
  });

  it('rejects cross-owner reversals and self reversals', async () => {
    const other = await insertEntry({ ownerId: ownerB, accountId: accountB, categoryId: categoryB });
    await expectDatabaseError(insertEntry({ reversalOfId: other.id }), '23503');
    const ownId = crypto.randomUUID();
    await expectDatabaseError(insertEntry({ id: ownId, reversalOfId: ownId }), '23514');
  });

  it('allows shared tags but prevents attaching the same tag twice', async () => {
    const first = await insertEntry();
    const second = await insertEntry();
    await insertLink(first.id);
    await insertLink(first.id, tagA2);
    await insertLink(second.id);
    const result = await pool.query<{ count: string }>('select count(*) from transaction_tags');
    expect(result.rows[0]?.count).toBe('3');
    await expectDatabaseError(insertLink(first.id), '23505');
  });

  it('keeps tag associations within one owner', async () => {
    const entry = await insertEntry();
    await expectDatabaseError(insertLink(entry.id, tagB), '23503');
    await expectDatabaseError(insertLink(entry.id, tagB, ownerB), '23503');
  });

  it('keeps linked tags and transactions until their association is explicitly removed', async () => {
    const entry = await insertEntry();
    await insertLink(entry.id);
    await expectDatabaseError(pool.query('delete from tags where id = $1', [tagA]), '23001');
    await expectDatabaseError(pool.query('delete from transactions where id = $1', [entry.id]), '23001');
    await pool.query('delete from transaction_tags where transaction_id = $1', [entry.id]);
    await pool.query('delete from tags where id = $1', [tagA]);
  });

  it('preserves the account, category, and original referenced by financial history', async () => {
    const original = await insertEntry();
    await insertEntry({ amount: '12.34', reversalOfId: original.id });
    await expectDatabaseError(pool.query('delete from accounts where id = $1', [accountA]), '23001');
    await expectDatabaseError(pool.query('delete from categories where id = $1', [categoryA]), '23001');
    await expectDatabaseError(pool.query('delete from transactions where id = $1', [original.id]), '23001');
    await pool.query('update accounts set archived_at = now() where id = $1', [accountA]);
    await pool.query('update categories set archived_at = now() where id = $1', [categoryA]);
    const result = await pool.query<{ count: string }>('select count(*) from transactions');
    expect(result.rows[0]?.count).toBe('2');
  });

  it('requires positive whole-cent budget limits within the supported range', async () => {
    await insertBudget({ limitAmount: '0.01' });
    await insertBudget({ month: '2026-02-01', limitAmount: '999999999999.99' });
    for (const limitAmount of ['0', '-1.00', '0.001', '1000000000000']) {
      await expectDatabaseError(insertBudget({ limitAmount }), '23514');
    }
  });

  it('identifies a budget month by its first day', async () => {
    await insertBudget();
    await expectDatabaseError(insertBudget({ month: '2026-01-15' }), '23514');
  });

  it('prevents budgets from using categories belonging to another owner', async () => {
    await expectDatabaseError(insertBudget({ categoryId: categoryB }), '23503');
  });

  it('enforces unique owner/category/month combinations during inserts and updates', async () => {
    await insertBudget();
    await expectDatabaseError(insertBudget(), '23505');
    const other = await insertBudget({ categoryId: categoryA2 });
    await expectDatabaseError(pool.query('update budgets set category_id = $1 where id = $2',
      [categoryA, other]), '23505');
    await insertBudget({ month: '2026-02-01' });
    await insertBudget({ ownerId: ownerB, categoryId: categoryB });
  });

  it('protects a budget category while allowing the budget to be edited and removed', async () => {
    const budget = await insertBudget();
    await expectDatabaseError(pool.query('delete from categories where id = $1', [categoryA]), '23001');
    await pool.query('update budgets set limit_amount = $1, updated_at = now() where id = $2', ['250.00', budget]);
    await pool.query('delete from budgets where id = $1', [budget]);
    await pool.query('delete from categories where id = $1', [categoryA]);
  });
});
