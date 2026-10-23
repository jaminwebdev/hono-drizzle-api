import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { expectDatabaseError } from '../support/assertions.js';
import { users } from '../../src/db/schema.js';
import {
  requireTestDatabaseName, testDatabaseOptions, verifyTestDatabase,
} from '../support/database.js';

const resources = ['accounts', 'categories', 'tags'] as const;
type Resource = typeof resources[number];
const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';

// Fast checks can discover this file without starting or touching a database.
describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')('PostgreSQL reference schema', () => {
  let pool: Pool;
  let database: ReturnType<typeof drizzle>;
  let name: string;

  beforeAll(async () => {
    name = requireTestDatabaseName(process.env.TEST_DATABASE_NAME);
    pool = new Pool({ ...testDatabaseOptions(), database: name, max: 2 });
    await verifyTestDatabase(pool, name);
    database = drizzle(pool);
  });

  beforeEach(async () => {
    // Never clear tables before checking the actual connected database and user.
    await verifyTestDatabase(pool, name);
    await pool.query('truncate table accounts, categories, tags, users cascade');
    await database.insert(users).values([
      { id: ownerA, email: 'owner-a@example.test' },
      { id: ownerB, email: 'owner-b@example.test' },
    ]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  function insertResource(resource: Resource, ownerId: string, resourceName: string) {
    // Resource names are the fixed table names above, never external input.
    const extraColumn = resource === 'accounts' ? ', type' : '';
    const extraValue = resource === 'accounts' ? ", 'checking'" : '';
    return pool.query<{ id: string }>(
      `insert into "${resource}" (owner_id, name${extraColumn}) values ($1, $2${extraValue}) returning id`,
      [ownerId, resourceName],
    );
  }

  it.each([...resources])('%s names are unique per owner regardless of letter case', async (resource) => {
    await insertResource(resource, ownerA, 'Shared');
    await insertResource(resource, ownerB, 'shared');
    const other = await insertResource(resource, ownerA, 'Other');
    await expectDatabaseError(insertResource(resource, ownerA, 'sHaReD'), '23505');
    await expectDatabaseError(pool.query(`update "${resource}" set name = $1 where id = $2`,
      ['SHARED', other.rows[0]?.id]), '23505');
    const result = await pool.query<{ count: string }>(`select count(*) from "${resource}"`);
    expect(result.rows[0]?.count).toBe('3');
  });

  it.each(['accounts', 'categories'] as const)('archiving %s keeps its name reserved', async (resource) => {
    const result = await insertResource(resource, ownerA, 'Archived');
    await pool.query(`update "${resource}" set archived_at = now() where id = $1`, [result.rows[0]?.id]);
    await expectDatabaseError(insertResource(resource, ownerA, 'ARCHIVED'), '23505');
  });

  it('enforces the USD-only account policy', async () => {
    await insertResource('accounts', ownerA, 'Checking');
    await expectDatabaseError(pool.query("insert into accounts (owner_id, name, type, currency) values ($1, 'Euro', 'cash', 'EUR')",
      [ownerA]), '23514');
  });
});
