import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { accounts, categories, tags, users } from '../../src/db/schema.js';
import {
  requireTestDatabaseName, testDatabaseOptions, verifyTestDatabase,
} from '../support/database.js';

const resources = ['accounts', 'categories', 'tags'] as const;
type Resource = typeof resources[number];
const ownerA = '00000000-0000-4000-8000-000000000001';
const ownerB = '00000000-0000-4000-8000-000000000002';

async function expectDatabaseError(operation: PromiseLike<unknown>, code: string) {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect((failure as { code?: string } | undefined)?.code).toBe(code);
}

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

  it('creates UUIDs, UTC instants, USD defaults, and unarchived references through Drizzle', async () => {
    const [user] = await database.insert(users).values({ email: 'third@example.test' }).returning();
    const [account] = await database.insert(accounts).values({
      ownerId: ownerA, name: 'Checking', type: 'checking',
    }).returning();
    const [category] = await database.insert(categories).values({ ownerId: ownerA, name: 'Food' }).returning();
    const [tag] = await database.insert(tags).values({ ownerId: ownerA, name: 'Recurring' }).returning();

    for (const row of [user, account, category, tag]) {
      expect(row?.id).toMatch(/^[a-f0-9-]{36}$/);
      expect(row?.createdAt).toBeInstanceOf(Date);
      expect(row?.updatedAt).toBeInstanceOf(Date);
    }
    expect(account?.currency).toBe('USD');
    expect(account?.archivedAt).toBeNull();
    expect(category?.archivedAt).toBeNull();
  });

  it('rejects duplicate normalized email addresses', async () => {
    await expectDatabaseError(pool.query('insert into users (email) values ($1)', ['owner-a@example.test']), '23505');
  });

  it.each(['', 'not-an-email', 'missing@domain', 'UPPER@example.test', ' user@example.test',
    'user@example.test ', 'user name@example.test', `${'a'.repeat(245)}@example.test`])('rejects an invalid or unnormalized email: %s', async (email) => {
    await expectDatabaseError(pool.query('insert into users (email) values ($1)', [email]), '23514');
  });

  it('requires an email', async () => {
    await expectDatabaseError(pool.query('insert into users (email) values (null)'), '23502');
  });

  for (const resource of resources) {
    describe(resource, () => {
      it('rejects case-insensitive duplicate names for one owner, including updates', async () => {
        await insertResource(resource, ownerA, 'Shared');
        const other = await insertResource(resource, ownerA, 'Other');
        await expectDatabaseError(insertResource(resource, ownerA, 'sHaReD'), '23505');
        await expectDatabaseError(pool.query(`update "${resource}" set name = $1 where id = $2`,
          ['SHARED', other.rows[0]?.id]), '23505');
      });

      it('allows the same name for different owners', async () => {
        await insertResource(resource, ownerA, 'Shared');
        await insertResource(resource, ownerB, 'shared');
        const result = await pool.query<{ count: string }>(`select count(*) from "${resource}"`);
        expect(result.rows[0]?.count).toBe('2');
      });

      it.each(['', ' ', ' Leading', 'Trailing ', '\t', 'Line\nbreak', 'a'.repeat(101)])('rejects blank, untrimmed, control-character, or long names: %s', async (resourceName) => {
        await expectDatabaseError(insertResource(resource, ownerA, resourceName), '23514');
      });

      it('allows the maximum name length', async () => {
        const result = await insertResource(resource, ownerA, 'a'.repeat(100));
        expect(result.rows).toHaveLength(1);
      });

      it('requires an owner', async () => {
        const extraColumn = resource === 'accounts' ? ', type' : '';
        const extraValue = resource === 'accounts' ? ", 'cash'" : '';
        await expectDatabaseError(pool.query(
          `insert into "${resource}" (name${extraColumn}) values ('Ownerless'${extraValue})`,
        ), '23502');
      });

      it('rejects a nonexistent owner and prevents deletion of an owner with references', async () => {
        await expectDatabaseError(insertResource(resource, crypto.randomUUID(), 'Missing owner'), '23503');
        await insertResource(resource, ownerA, 'Owned');
        await expectDatabaseError(pool.query('delete from users where id = $1', [ownerA]), '23001');
      });

      it('supports a same-owner composite foreign key and rejects a cross-owner link', async () => {
        const result = await insertResource(resource, ownerA, 'Linked');
        const client = await pool.connect();
        try {
          await client.query('begin');
          // PostgreSQL forbids foreign keys from temporary tables to regular tables.
          // Rolling back removes this regular probe table after the check.
          await client.query(`create table owner_link_probe (
            owner_id uuid not null,
            resource_id uuid not null,
            foreign key (owner_id, resource_id) references "${resource}" (owner_id, id)
          )`);
          await client.query('insert into owner_link_probe values ($1, $2)', [ownerA, result.rows[0]?.id]);
          await expectDatabaseError(client.query('insert into owner_link_probe values ($1, $2)',
            [ownerB, result.rows[0]?.id]), '23503');
        } finally {
          await client.query('rollback');
          client.release();
        }
      });
    });
  }

  it.each(['checking', 'savings', 'cash'])('accepts account type %s', async (type) => {
    const result = await pool.query('insert into accounts (owner_id, name, type) values ($1, $2, $3) returning id',
      [ownerA, type, type]);
    expect(result.rows).toHaveLength(1);
  });

  it('rejects unsupported account types', async () => {
    await expectDatabaseError(pool.query('insert into accounts (owner_id, name, type) values ($1, $2, $3)',
      [ownerA, 'Unsupported', 'credit']), '23514');
  });

  it('rejects non-USD currencies', async () => {
    await expectDatabaseError(pool.query("insert into accounts (owner_id, name, type, currency) values ($1, 'Euro', 'cash', 'EUR')",
      [ownerA]), '23514');
  });

  it.each(['accounts', 'categories'] as const)('archives %s without releasing its unique name', async (resource) => {
    const result = await insertResource(resource, ownerA, 'Archived');
    const archivedAt = new Date('2026-01-01T12:00:00+02:00');
    const updated = await pool.query<{ archived_at: Date }>(
      `update "${resource}" set archived_at = $1, updated_at = now() where id = $2 returning archived_at`,
      [archivedAt, result.rows[0]?.id],
    );
    expect(updated.rows[0]?.archived_at.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    await expectDatabaseError(insertResource(resource, ownerA, 'ARCHIVED'), '23505');
    await pool.query(`update "${resource}" set archived_at = null where id = $1`, [result.rows[0]?.id]);
  });
});
