import { describe, expect, it, spyOn } from 'bun:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { createApi } from '../src/api.js';

const json = (method: string, body: unknown) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('account and category request validation', () => {
  for (const resource of ['accounts', 'categories'] as const) {
    it(`${resource} rejects invalid mutation fields, IDs, and list options before querying the database`, async () => {
      const pool = new Pool();
      const query = spyOn(pool, 'query').mockImplementation(() => { throw new Error('Unexpected database query.'); });
      const app = createApp({ apiRoutes: createApi(drizzle(pool)), findOwner: () => Promise.resolve(true), logRequest: () => {} });
      try {
        const base = `/api/v1/${resource}`;
        const id = 'a0000000-0000-4000-8000-000000000001';
        const valid = resource === 'accounts' ? { name: 'Valid', type: 'cash' } : { name: 'Valid' };
        for (const body of [{ ...valid, name: ' ' }, { ...valid, name: 'Line\nbreak' }, { ...valid, ownerId: 'private-secret' }]) {
          expect((await app.request(base, json('POST', body))).status).toBe(422);
        }
        expect((await app.request(`${base}/${id}`, json('PATCH', {}))).status).toBe(422);
        expect((await app.request(`${base}/${id}`, json('PATCH', { archivedAt: '2026-01-01T00:00:00Z' }))).status).toBe(422);
        expect((await app.request(`${base}/${id}`, json('PATCH', { archived: 'true' }))).status).toBe(422);
        expect((await app.request(`${base}/invalid-id`)).status).toBe(422);
        for (const query of ['limit=101', 'page=0', 'page=1&page=2', 'includeArchived=yes', 'ownerId=private-secret', 'sort=private-secret', 'direction=sideways', 'page=9007199254740991']) {
          expect((await app.request(`${base}?${query}`)).status).toBe(422);
        }
        if (resource === 'accounts') {
          expect((await app.request(base, json('POST', { name: 'Euro', type: 'cash', currency: 'EUR' }))).status).toBe(422);
          expect((await app.request(base, json('POST', { name: 'Credit', type: 'credit' }))).status).toBe(422);
        }
        expect(query).not.toHaveBeenCalled();
      } finally {
        query.mockRestore();
        await pool.end();
      }
    });
  }
});
