import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DEMO_OWNER_ID, demoBudgets, demoTransactions } from '../../src/db/demo-data.js';
import { seedDemo } from '../../src/db/seed-demo.js';
import { requireTestDatabaseName, testDatabaseOptions, verifyTestDatabase } from '../support/database.js';

async function expectSeedFailure(operation: Promise<unknown>, message: string) {
  let failure: unknown;
  try { await operation; } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain(message);
}

describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')('demo seed behavior', () => {
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
  });
  afterAll(async () => { await pool?.end(); });

  it('creates related demo data with known balances and monthly spending', async () => {
    expect(await seedDemo(drizzle(pool), 'local')).toBe('created');
    const balances = await pool.query<{ name: string; balance: string }>(`select a.name, sum(t.amount)::text as balance
      from accounts a join transactions t on t.account_id = a.id and t.owner_id = a.owner_id
      where a.owner_id = $1 group by a.name order by a.name`, [DEMO_OWNER_ID]);
    expect(balances.rows).toEqual([{ name: 'Checking', balance: '6282.90' }, { name: 'Savings', balance: '5000.00' }]);
    const spending = await pool.query<{ spent: string }>(`select (-sum(t.amount))::text as spent from transactions t
      join categories c on c.id = t.category_id and c.owner_id = t.owner_id
      where t.owner_id = $1 and c.name = 'Groceries' and t.occurred_at >= '2026-01-01T00:00:00Z'
      and t.occurred_at < '2026-02-01T00:00:00Z'`, [DEMO_OWNER_ID]);
    expect(spending.rows[0]?.spent).toBe('80.00');
    const links = await pool.query<{ count: string }>('select count(*) from transaction_tags where owner_id = $1', [DEMO_OWNER_ID]);
    expect(links.rows[0]?.count).toBe('5');
  });

  it('does nothing on repeat runs and preserves edits and unrelated rows', async () => {
    const db = drizzle(pool);
    await seedDemo(db, 'local');
    await pool.query('update budgets set limit_amount = 777.00 where id = $1', [demoBudgets[0]?.id]);
    await pool.query("update accounts set name = 'My checking' where owner_id = $1 and type = 'checking'", [DEMO_OWNER_ID]);
    await pool.query("insert into users (email) values ('unrelated@example.test')");
    expect(await seedDemo(db, 'local')).toBe('unchanged');
    const edited = await pool.query<{ limit_amount: string }>('select limit_amount from budgets where id = $1', [demoBudgets[0]?.id]);
    expect(edited.rows[0]?.limit_amount).toBe('777.00');
    const accounts = await pool.query<{ name: string }>("select name from accounts where owner_id = $1 and type = 'checking'", [DEMO_OWNER_ID]);
    expect(accounts.rows[0]?.name).toBe('My checking');
    const users = await pool.query<{ count: string }>("select count(*) from users where email = 'unrelated@example.test'");
    expect(users.rows[0]?.count).toBe('1');
  });

  it('rejects incomplete fixtures without replacing missing rows or losing edits', async () => {
    const db = drizzle(pool);
    await seedDemo(db, 'local');
    await pool.query('delete from budgets where id = $1', [demoBudgets[0]?.id]);
    await pool.query('update budgets set limit_amount = 777.00 where id = $1', [demoBudgets[1]?.id]);
    await expectSeedFailure(seedDemo(db, 'local'), 'incomplete or conflicting');
    const rows = await pool.query<{ id: string; limit_amount: string }>('select id, limit_amount from budgets');
    expect(rows.rows).toHaveLength(demoBudgets.length - 1);
    expect(rows.rows.find((row) => row.id === demoBudgets[1]?.id)?.limit_amount).toBe('777.00');
  });

  it('rejects conflicting demo identity without leaving seed rows behind', async () => {
    await pool.query("insert into users (email) values ('demo@example.test')");
    await expectSeedFailure(seedDemo(drizzle(pool), 'local'), 'conflict with existing data');
    const rows = await pool.query<{ count: string }>('select count(*) from users where id = $1', [DEMO_OWNER_ID]);
    expect(rows.rows[0]?.count).toBe('0');
    const entries = await pool.query<{ count: string }>('select count(*) from transactions');
    expect(entries.rows[0]?.count).toBe('0');
  });

  it('serializes competing seed runs into one creation and one no-op', async () => {
    const results = await Promise.all([seedDemo(drizzle(pool), 'local'), seedDemo(drizzle(pool), 'local')]);
    expect(results.sort()).toEqual(['created', 'unchanged']);
    const entries = await pool.query<{ count: string }>('select count(*) from transactions');
    expect(entries.rows[0]?.count).toBe(String(demoTransactions.length));
  });

  it('rejects production before opening a database transaction', async () => {
    // An unusable pool proves the guard runs before attempting a connection.
    const disconnected = new Pool({ host: '127.0.0.1', port: 1 });
    try {
      await expectSeedFailure(seedDemo(drizzle(disconnected), 'production'), 'only with APP_ENV=local');
    } finally {
      await disconnected.end();
    }
  });
});
