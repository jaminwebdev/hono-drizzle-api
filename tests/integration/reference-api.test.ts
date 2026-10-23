import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Pool } from 'pg';
import { createApp } from '../../src/app.js';
import { createApi } from '../../src/api.js';
import { createDatabase } from '../../src/db/client.js';
import { DEMO_OWNER_ID } from '../../src/lib/demo-identity.js';
import { requireTestDatabaseName, testDatabaseOptions, verifyTestDatabase } from '../support/database.js';

const resources = ['accounts', 'categories'] as const;
type Resource = typeof resources[number];
const otherOwner = 'b0000000-0000-4000-8000-000000000001';
interface Row {
  id: string; name: string; archivedAt: string | null; createdAt: string; updatedAt: string;
  type?: string; currency?: string;
}
interface List { data: Row[]; pagination: { page: number; limit: number; hasMore: boolean } }
const json = (method: string, body: unknown) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')('account and category HTTP APIs', () => {
  let pool: Pool;
  let database: ReturnType<typeof createDatabase>;
  let app: ReturnType<typeof createApp>;
  let name: string;
  beforeAll(async () => {
    name = requireTestDatabaseName(process.env.TEST_DATABASE_NAME);
    const options = { ...testDatabaseOptions(), database: name };
    pool = new Pool(options);
    await verifyTestDatabase(pool, name);
    database = createDatabase(options);
  });
  beforeEach(async () => {
    await verifyTestDatabase(pool, name);
    await pool.query('truncate table users cascade');
    await pool.query('insert into users (id, email) values ($1, $2), ($3, $4)',
      [DEMO_OWNER_ID, 'demo@example.test', otherOwner, 'other@example.test']);
    app = createApp({ apiRoutes: createApi(database.db), findOwner: (id) => database.findOwner(id), logRequest: () => {} });
  });
  afterAll(async () => {
    await database?.close();
    await pool?.end();
  });

  async function create(resource: Resource, name: string) {
    const body = resource === 'accounts' ? { name, type: 'cash' } : { name };
    const response = await app.request(`/api/v1/${resource}`, json('POST', body));
    expect(response.status).toBe(201);
    const result = await response.json() as { data: Row };
    expect(response.headers.get('location')).toBe(`/api/v1/${resource}/${result.data.id}`);
    return result.data;
  }

  for (const resource of resources) {
    describe(resource, () => {
      it('creates, reads, and updates a record through the API', async () => {
        const created = await create(resource, ' Wallet ');
        expect(created.name).toBe('Wallet');
        expect(created.archivedAt).toBeNull();
        if (resource === 'accounts') expect(created).toMatchObject({ type: 'cash', currency: 'USD' });
        const read = await app.request(`/api/v1/${resource}/${created.id}`);
        expect(read.status).toBe(200);
        expect(await read.json()).toEqual({ data: created });
        const changes = resource === 'accounts' ? { name: 'Renamed', type: 'checking' } : { name: 'Renamed' };
        const updated = await app.request(`/api/v1/${resource}/${created.id}`, json('PATCH', changes));
        expect(updated.status).toBe(200);
        const row = (await updated.json() as { data: Row }).data;
        expect(row.name).toBe('Renamed');
        expect(row.createdAt).toBe(created.createdAt);
        expect(Date.parse(row.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
        if (resource === 'accounts') expect(row.type).toBe('checking');
      });

      it('returns safe conflicts for duplicate creates and renames, including archived names', async () => {
        const first = await create(resource, 'Shared');
        const other = await create(resource, 'Other');
        const duplicate = await app.request(`/api/v1/${resource}`, json('POST', resource === 'accounts'
          ? { name: 'SHARED', type: 'checking' } : { name: 'SHARED' }));
        expect(duplicate.status).toBe(409);
        expect(await duplicate.json()).toMatchObject({ error: { code: 'CONFLICT', status: 409 } });
        const renamed = await app.request(`/api/v1/${resource}/${other.id}`, json('PATCH', { name: 'shared' }));
        expect(renamed.status).toBe(409);
        const archived = await app.request(`/api/v1/${resource}/${first.id}`, json('PATCH', { archived: true }));
        expect(archived.status).toBe(200);
        const reused = await app.request(`/api/v1/${resource}`, json('POST', resource === 'accounts'
          ? { name: 'shared', type: 'cash' } : { name: 'shared' }));
        expect(reused.status).toBe(409);
        expect(await reused.text()).not.toContain(`${resource}_owner_name_unique`);
      });

      it('archives and restores records while keeping them readable and preserving the original archive timestamp', async () => {
        const created = await create(resource, 'Archived');
        const patch = () => app.request(`/api/v1/${resource}/${created.id}`, json('PATCH', { archived: true }));
        const archived = (await (await patch()).json() as { data: Row }).data;
        expect(archived.archivedAt).not.toBeNull();
        const repeated = (await (await patch()).json() as { data: Row }).data;
        expect(repeated.archivedAt).toBe(archived.archivedAt);
        const hidden = await app.request(`/api/v1/${resource}`);
        expect((await hidden.json() as List).data).toEqual([]);
        const visible = await app.request(`/api/v1/${resource}?includeArchived=true`);
        expect((await visible.json() as List).data.map((row) => row.id)).toEqual([created.id]);
        expect((await app.request(`/api/v1/${resource}/${created.id}`)).status).toBe(200);
        const restored = await app.request(`/api/v1/${resource}/${created.id}`, json('PATCH', { archived: false }));
        expect(restored.status).toBe(200);
        expect((await restored.json() as { data: Row }).data.archivedAt).toBeNull();
        const active = await app.request(`/api/v1/${resource}`);
        expect((await active.json() as List).data.map((row) => row.id)).toEqual([created.id]);
      });

      it('hides another owner in lists, gets, and patches while allowing their names to be reused', async () => {
        const extraColumn = resource === 'accounts' ? ', type' : '';
        const extraValue = resource === 'accounts' ? ", 'cash'" : '';
        const result = await pool.query<{ id: string }>(`insert into "${resource}" (owner_id, name${extraColumn})
          values ($1, 'Private'${extraValue}) returning id`, [otherOwner]);
        const foreignId = result.rows[0]!.id;
        const own = await create(resource, 'Private');
        const listed = await app.request(`/api/v1/${resource}`);
        expect((await listed.json() as List).data.map((row) => row.id)).toEqual([own.id]);
        for (const id of [foreignId, crypto.randomUUID()]) {
          const read = await app.request(`/api/v1/${resource}/${id}`);
          expect(read.status).toBe(404);
          expect(await read.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
          const update = await app.request(`/api/v1/${resource}/${id}`, json('PATCH', { name: 'Stolen', archived: true }));
          expect(update.status).toBe(404);
        }
        const unchanged = await pool.query<{ name: string; archived_at: Date | null }>(
          `select name, archived_at from "${resource}" where id = $1`, [foreignId]);
        expect(unchanged.rows[0]).toEqual({ name: 'Private', archived_at: null });
      });

      it('paginates deterministically, reports hasMore, and returns an empty page past the end', async () => {
        const rows = [await create(resource, 'Charlie'), await create(resource, 'Alpha'), await create(resource, 'Bravo')];
        const first = await app.request(`/api/v1/${resource}?limit=2`);
        const page = await first.json() as List;
        expect(page.data.map((row) => row.name)).toEqual(['Alpha', 'Bravo']);
        expect(page.pagination).toEqual({ page: 1, limit: 2, hasMore: true });
        const second = await app.request(`/api/v1/${resource}?limit=2&page=2`);
        expect(await second.json()).toMatchObject({ data: [{ name: 'Charlie' }], pagination: { page: 2, limit: 2, hasMore: false } });
        const empty = await app.request(`/api/v1/${resource}?page=3&limit=2`);
        expect(await empty.json()).toEqual({ data: [], pagination: { page: 3, limit: 2, hasMore: false } });
        // Equal sort values must still produce stable pages with no repeated or missing IDs.
        await pool.query(`update "${resource}" set created_at = '2026-01-01T00:00:00Z' where owner_id = $1`, [DEMO_OWNER_ID]);
        const ids: string[] = [];
        for (let page = 1; page <= 3; page++) {
          const response = await app.request(`/api/v1/${resource}?sort=createdAt&direction=asc&limit=1&page=${page}`);
          ids.push(...(await response.json() as List).data.map((row) => row.id));
        }
        expect(ids).toEqual(rows.map((row) => row.id).sort());
      });
    });
  }

  it('keeps financial history when its account and category are archived', async () => {
    const account = await create('accounts', 'Checking');
    const category = await create('categories', 'Food');
    await pool.query(`insert into transactions (owner_id, account_id, category_id, amount, description, occurred_at)
      values ($1, $2, $3, '-12.34', 'Groceries', '2026-01-15T12:00:00Z')`, [DEMO_OWNER_ID, account.id, category.id]);
    expect((await app.request(`/api/v1/accounts/${account.id}`, json('PATCH', { archived: true }))).status).toBe(200);
    expect((await app.request(`/api/v1/categories/${category.id}`, json('PATCH', { archived: true }))).status).toBe(200);
    const history = await pool.query<{ amount: string }>('select amount from transactions where owner_id = $1', [DEMO_OWNER_ID]);
    expect(history.rows).toEqual([{ amount: '-12.34' }]);
  });
});
