import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { Pool } from 'pg';
import { createApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import { DEMO_OWNER_ID } from '../../src/db/demo-data.js';
import { seedDemo } from '../../src/db/seed-demo.js';
import type { AppEnv } from '../../src/lib/http.js';
import { requireTestDatabaseName, testDatabaseOptions, verifyTestDatabase } from '../support/database.js';

describe.skipIf(process.env.RUN_DATABASE_TESTS !== '1')('HTTP demo owner lookup', () => {
  let pool: Pool;
  let database: ReturnType<typeof createDatabase>;
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
  });
  afterAll(async () => {
    await database?.close();
    await pool?.end();
  });

  it('requires the seeded owner and uses its ID for subsequent requests', async () => {
    const api = new Hono<AppEnv>();
    api.get('/context', (c) => c.json({ data: { ownerId: c.get('ownerId') } }));
    const app = createApp({ apiRoutes: api, findOwner: (id) => database.findOwner(id), logRequest: () => {} });
    const missing = await app.request('/api/v1/context');
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ error: { code: 'DEMO_OWNER_MISSING' } });
    await seedDemo(database.db, 'local');
    const ready = await app.request('/api/v1/context?ownerId=someone-else');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ data: { ownerId: DEMO_OWNER_ID } });
  });
});
