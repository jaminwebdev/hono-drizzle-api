import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';
import * as v from 'valibot';
import {
  accountIdSchema,
  createAccountSchema,
} from '../../src/features/accounts';
import { createApp } from '../../src/app';
import {
  accounts,
  sessions,
  transactionHistory,
  transactions,
  users,
} from '../../src/db/schema';
import { createTestDatabase } from './setup';

const database = createTestDatabase();
const origin = 'http://127.0.0.1:3002';
const ownedUsers: string[] = [];
let log: ReturnType<typeof spyOn<typeof console, 'log'>>;
const app = createApp(database, {
  APP_ENV: 'test',
  API_ORIGIN: origin,
  CORS_ORIGINS: [],
});

async function signedIn() {
  const [user] = await database
    .insert(users)
    .values({
      email: `account-${crypto.randomUUID()}@example.test`,
      passwordHash: 'unused-test-hash',
    })
    .returning({ id: users.id });
  ownedUsers.push(user!.id);
  const credential = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString('base64url');
  await database.insert(sessions).values({
    userId: user!.id,
    tokenHash: new Bun.CryptoHasher('sha256').update(credential).digest('hex'),
    expiresAt: new Date(Date.now() + 604800_000),
  });
  return { id: user!.id, cookie: `session=${credential}` };
}

function create(
  cookie: string | undefined,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request('/api/v1/accounts', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
function removeAccount(
  cookie: string | undefined,
  id: string,
  headers: Record<string, string> = {},
) {
  return app.request(`/api/v1/accounts/${id}`, {
    method: 'DELETE',
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
  });
}

function detail(cookie: string | undefined, id: string) {
  return app.request(`/api/v1/accounts/${id}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function patchAccount(
  cookie: string | undefined,
  id: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(`/api/v1/accounts/${id}`, {
    method: 'PATCH',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

type AccountResponse = {
  data: {
    id: string;
    name: string;
    type: string;
    currency: string;
    openingBalance: string;
    isArchived: boolean;
    createdAt: string;
    updatedAt: string;
  };
};

type AccountListResponse = {
  data: AccountResponse['data'][];
  pagination: { page: number; limit: number; total: number };
};

function list(cookie: string | undefined, query = '') {
  return app.request(`/api/v1/accounts${query ? `?${query}` : ''}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

beforeEach(() => {
  log = spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  log.mockRestore();
  if (ownedUsers.length) {
    await database
      .delete(transactionHistory)
      .where(inArray(transactionHistory.userId, ownedUsers));
    await database
      .delete(transactions)
      .where(inArray(transactions.userId, ownedUsers));
    await database.delete(accounts).where(inArray(accounts.userId, ownedUsers));
    await database.delete(users).where(inArray(users.id, ownedUsers));
  }
  ownedUsers.length = 0;
});
afterAll(async () => {
  await database.$client.close();
});

describe('account creation and owned details', () => {
  test('creates for the session owner with defaults, a Location, and matching detail', async () => {
    const user = await signedIn();
    const response = await create(user.cookie, {
      name: '  Daily spending  ',
      type: 'checking',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as AccountResponse;
    expect(body.data.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.data).toEqual({
      id: body.data.id,
      name: 'Daily spending',
      type: 'checking',
      currency: 'USD',
      openingBalance: '0.00',
      isArchived: false,
      createdAt: body.data.createdAt,
      updatedAt: body.data.updatedAt,
    });
    expect(new Date(body.data.createdAt).toISOString()).toBe(
      body.data.createdAt,
    );
    expect(body.data.updatedAt).toBe(body.data.createdAt);
    expect(response.headers.get('Location')).toBe(
      `/api/v1/accounts/${body.data.id}`,
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [stored] = await database
      .select({ userId: accounts.userId })
      .from(accounts)
      .where(eq(accounts.id, body.data.id));
    expect(stored!.userId).toBe(user.id);
    const fetched = await detail(user.cookie, body.data.id);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toEqual(body);
    expect(JSON.stringify(log.mock.calls)).not.toContain(user.cookie);
  });

  test.each([
    ['checking', 'USD', '0.00'],
    ['savings', 'EUR', '1500.00'],
    ['cash', 'GBP', '0.01'],
    ['credit', 'USD', '-24.50'],
    ['investment', 'EUR', '9999999999999999.99'],
    ['credit', 'GBP', '-9999999999999999.99'],
  ])(
    'preserves exact money for %s / %s / %s',
    async (type, currency, openingBalance) => {
      const user = await signedIn();
      const response = await create(user.cookie, {
        name: 'Balance example',
        type,
        currency,
        openingBalance,
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as AccountResponse;
      expect(body.data).toMatchObject({ type, currency, openingBalance });
      const fetched = await detail(user.cookie, body.data.id);
      expect(await fetched.json()).toEqual(body);
    },
  );

  test('returns the same 404 for another owner and a nonexistent ID', async () => {
    const first = await signedIn();
    const second = await signedIn();
    const created = await create(first.cookie, {
      name: 'Private account',
      type: 'cash',
    });
    const { data } = (await created.json()) as AccountResponse;
    for (const id of [data.id, crypto.randomUUID()]) {
      const response = await detail(second.cookie, id);
      expect(response.status).toBe(404);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        error: { code: 'NOT_FOUND', message: 'The account was not found.' },
      });
      expect(JSON.stringify(body)).not.toContain('Private account');
    }
    expect((await detail(first.cookie, data.id)).status).toBe(200);
  });

  test.each([undefined, 'session=malformed', `session=${'a'.repeat(43)}`])(
    'requires a valid session for create and detail: %s',
    async (cookie) => {
      expect(
        (await create(cookie, { name: 'Account', type: 'cash' })).status,
      ).toBe(401);
      expect((await detail(cookie, crypto.randomUUID())).status).toBe(401);
    },
  );

  test.each([
    { userId: 'client-owner' },
    { user_id: 'client-owner' },
    { id: crypto.randomUUID() },
    { isArchived: true },
    { createdAt: new Date().toISOString() },
    { tagIds: [] },
    { type: 'loan' },
    { currency: 'JPY' },
    { name: '  ' },
    { openingBalance: 24.5 },
    { openingBalance: '-0.00' },
    { openingBalance: '1.001' },
    { openingBalance: '10000000000000000.00' },
  ])('rejects invalid input before inserting: %j', async (override) => {
    const user = await signedIn();
    const insert = spyOn(database, 'insert');
    try {
      const response = await create(user.cookie, {
        name: 'Account',
        type: 'checking',
        ...override,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'INVALID_INPUT' },
      });
      expect(insert).not.toHaveBeenCalled();
    } finally {
      insert.mockRestore();
    }
  });

  test.each(['', 'null', 'http://untrusted.example', origin + '/'])(
    'rejects an unapproved write origin before session or insert work: %s',
    async (value) => {
      const update = spyOn(database, 'update');
      const insert = spyOn(database, 'insert');
      try {
        const response = await create(
          undefined,
          { name: 'Account', type: 'cash' },
          { Origin: value },
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: 'ORIGIN_REJECTED' },
        });
        expect(update).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
      } finally {
        update.mockRestore();
        insert.mockRestore();
      }
    },
  );

  test('uses the central JSON, content-type, and parameter error handling', async () => {
    const user = await signedIn();
    for (const body of ['', '{"private-input":']) {
      const response = await app.request('/api/v1/accounts', {
        method: 'POST',
        headers: {
          Origin: origin,
          Cookie: user.cookie,
          'Content-Type': 'application/json',
        },
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain('private-input');
    }
    expect(
      (await create(user.cookie, {}, { 'Content-Type': 'text/plain' })).status,
    ).toBe(415);
    expect((await detail(user.cookie, 'not-a-uuid')).status).toBe(400);
    expect(
      (await detail(user.cookie, `${crypto.randomUUID()}?userId=${user.id}`))
        .status,
    ).toBe(400);
    const queryResponse = await app.request('/api/v1/accounts?userId=other', {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: user.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Account', type: 'cash' }),
    });
    expect(queryResponse.status).toBe(400);
  });

  test('hides unexpected database errors on both routes', async () => {
    const user = await signedIn();
    const insert = spyOn(database, 'insert').mockImplementation(() => {
      throw new Error('private-account-insert');
    });
    try {
      const response = await create(user.cookie, {
        name: 'Account',
        type: 'cash',
      });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('private-account-insert');
      expect(response.headers.has('Location')).toBe(false);
    } finally {
      insert.mockRestore();
    }
    const original = database.select.bind(database);
    const select = spyOn(database, 'select');
    select.mockImplementationOnce(original).mockImplementationOnce(() => {
      throw new Error('private-account-select');
    });
    try {
      const response = await detail(user.cookie, crypto.randomUUID());
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('private-account-select');
    } finally {
      select.mockRestore();
    }
  });
});

describe('owned account lists and search', () => {
  test('bounds pages, counts only the owner, and returns empty pages without losing the total', async () => {
    const owner = await signedIn();
    const other = await signedIn();
    await database.insert(accounts).values([
      ...Array.from({ length: 101 }, (_, index) => ({
        userId: owner.id,
        name: `Account ${String(index).padStart(3, '0')}`,
        type: 'checking' as const,
      })),
      { userId: other.id, name: 'Account 000 foreign', type: 'cash' },
    ]);
    const response = await list(owner.cookie);
    expect(response.status).toBe(200);
    const first = (await response.json()) as AccountListResponse;
    expect(first.pagination).toEqual({ page: 1, limit: 25, total: 101 });
    expect(first.data).toHaveLength(25);
    expect(first.data[0]!.name).toBe('Account 000');
    expect(first.data[24]!.name).toBe('Account 024');
    expect(
      first.data.every((account) => account.openingBalance === '0.00'),
    ).toBe(true);
    const largest = (await (
      await list(owner.cookie, 'limit=100')
    ).json()) as AccountListResponse;
    expect(largest.data).toHaveLength(100);
    const last = (await (
      await list(owner.cookie, 'page=2&limit=100')
    ).json()) as AccountListResponse;
    expect(last.data.map((account) => account.name)).toEqual(['Account 100']);
    expect(last.pagination).toEqual({ page: 2, limit: 100, total: 101 });
    const beyond = (await (
      await list(owner.cookie, 'page=3&limit=100')
    ).json()) as AccountListResponse;
    expect(beyond).toEqual({
      data: [],
      pagination: { page: 3, limit: 100, total: 101 },
    });
    const secondOwner = (await (
      await list(other.cookie)
    ).json()) as AccountListResponse;
    expect(secondOwner.pagination.total).toBe(1);
    expect(secondOwner.data.map((account) => account.name)).toEqual([
      'Account 000 foreign',
    ]);
  });

  test('orders equal names by ID consistently across pages', async () => {
    const owner = await signedIn();
    const created = await database
      .insert(accounts)
      .values(
        Array.from({ length: 4 }, () => ({
          userId: owner.id,
          name: 'Same name',
          type: 'cash' as const,
        })),
      )
      .returning({ id: accounts.id });
    const ids: string[] = [];
    for (const page of [1, 2]) {
      const body = (await (
        await list(owner.cookie, `page=${page}&limit=2`)
      ).json()) as AccountListResponse;
      ids.push(...body.data.map((account) => account.id));
    }
    expect(ids).toEqual(created.map((account) => account.id).sort());
    expect(new Set(ids).size).toBe(4);
  });

  test('combines case-insensitive name search and archive filters for rows and totals', async () => {
    const owner = await signedIn();
    const other = await signedIn();
    await database.insert(accounts).values([
      {
        userId: owner.id,
        name: 'Daily Checking',
        type: 'checking',
        isArchived: false,
      },
      {
        userId: owner.id,
        name: 'Old checking',
        type: 'checking',
        isArchived: true,
      },
      { userId: owner.id, name: 'Savings', type: 'savings', isArchived: true },
      {
        userId: other.id,
        name: 'Foreign checking',
        type: 'checking',
        isArchived: true,
      },
    ]);
    for (const [query, names] of [
      ['q=%20CHECKING%20', ['Daily Checking', 'Old checking']],
      ['q=checking&archived=false', ['Daily Checking']],
      ['q=checking&archived=true', ['Old checking']],
      ['archived=false', ['Daily Checking']],
      ['archived=true', ['Old checking', 'Savings']],
      ['q=foreign', []],
      ['q=missing', []],
    ] as const) {
      const response = await list(owner.cookie, query);
      expect(response.status).toBe(200);
      const body = (await response.json()) as AccountListResponse;
      expect(body.data.map((account) => account.name)).toEqual([...names]);
      expect(body.pagination.total).toBe(names.length);
    }
  });

  test('treats percent, underscore, backslash, and SQL-like input literally', async () => {
    const owner = await signedIn();
    const names = [
      'Rate 100%',
      'Rate 1000',
      'Part_one',
      'PartXone',
      'folder\\cash',
      'foldercash',
      "Quote ' account",
    ];
    await database.insert(accounts).values(
      names.map((name) => ({
        userId: owner.id,
        name,
        type: 'cash' as const,
      })),
    );
    for (const [q, expected] of [
      ['%', ['Rate 100%']],
      ['_', ['Part_one']],
      ['\\', ['folder\\cash']],
      ["'", ["Quote ' account"]],
      ["' OR true --", []],
    ] as const) {
      const response = await list(
        owner.cookie,
        new URLSearchParams({ q }).toString(),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as AccountListResponse;
      expect(body.data.map((account) => account.name)).toEqual([...expected]);
      expect(body.pagination.total).toBe(expected.length);
    }
  });

  test('returns an empty owned list and accepts the exact maximum offset', async () => {
    const owner = await signedIn();
    const response = await list(owner.cookie, 'page=101&limit=100');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      pagination: { page: 101, limit: 100, total: 0 },
    });
  });

  test.each([undefined, 'session=invalid'])(
    'requires authentication for list requests: %s',
    async (cookie) => {
      expect((await list(cookie)).status).toBe(401);
    },
  );

  test.each([
    'page=0',
    'limit=101',
    'page=102&limit=100',
    'q=' + 'a'.repeat(101),
    'archived=1',
    'page=1&page=2',
    'page=1&page=1',
    'limit=25&limit=25',
    'q=cash&q=savings',
    'archived=false&archived=false',
    'userId=other',
    'tagId=not-yet-supported',
    'page=1%0A',
    'limit=',
  ])('rejects invalid queries before account queries: %s', async (query) => {
    const owner = await signedIn();
    const select = spyOn(database, 'select');
    try {
      const response = await list(owner.cookie, query);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'INVALID_INPUT' },
      });
      // Only the shared session middleware reads the user; no account query runs.
      expect(select).toHaveBeenCalledTimes(1);
    } finally {
      select.mockRestore();
    }
  });

  test('hides count failures rather than returning a partial list', async () => {
    const owner = await signedIn();
    const original = database.select.bind(database);
    const select = spyOn(database, 'select')
      .mockImplementationOnce(original)
      .mockImplementationOnce(original)
      .mockImplementationOnce(() => {
        throw new Error('private-account-count');
      });
    try {
      const response = await list(owner.cookie);
      expect(response.status).toBe(500);
      const body: unknown = await response.json();
      expect(body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
      expect(body).not.toHaveProperty('data');
      expect(JSON.stringify(body)).not.toContain('private-account-count');
    } finally {
      select.mockRestore();
    }
  });
});

describe('account renaming and archival', () => {
  test('patches only supplied fields, preserves immutable values, and updates the timestamp', async () => {
    const owner = await signedIn();
    const created = await create(owner.cookie, {
      name: 'Original',
      type: 'credit',
      currency: 'GBP',
      openingBalance: '-24.50',
    });
    const before = ((await created.json()) as AccountResponse).data;
    const now = Date.now() + 1000;
    const clock = spyOn(Date, 'now').mockReturnValue(now);
    try {
      const renamed = await patchAccount(owner.cookie, before.id, {
        name: '  New name  ',
      });
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toEqual({
        data: {
          ...before,
          name: 'New name',
          updatedAt: new Date(now).toISOString(),
        },
      });
      expect(renamed.headers.get('Cache-Control')).toBe('no-store');
      const [stored] = await database
        .select({ owner: accounts.userId })
        .from(accounts)
        .where(eq(accounts.id, before.id));
      expect(stored!.owner).toBe(owner.id);
      const archived = await patchAccount(owner.cookie, before.id, {
        isArchived: true,
      });
      expect(archived.status).toBe(200);
      const archivedBody = (await archived.json()) as AccountResponse;
      expect(archivedBody.data).toMatchObject({
        name: 'New name',
        isArchived: true,
        currency: 'GBP',
        openingBalance: '-24.50',
      });
      expect(
        (
          (await (
            await list(owner.cookie, 'archived=false')
          ).json()) as AccountListResponse
        ).data,
      ).toHaveLength(0);
      expect(
        (
          (await (
            await list(owner.cookie, 'archived=true')
          ).json()) as AccountListResponse
        ).data.map((row) => row.id),
      ).toEqual([before.id]);
      expect((await detail(owner.cookie, before.id)).status).toBe(200);
      const restored = await patchAccount(owner.cookie, before.id, {
        name: 'Restored',
        isArchived: false,
      });
      expect(restored.status).toBe(200);
      expect(((await restored.json()) as AccountResponse).data).toMatchObject({
        ...before,
        name: 'Restored',
        isArchived: false,
        updatedAt: new Date(now).toISOString(),
      });
      expect(
        (
          (await (
            await list(owner.cookie, 'archived=false')
          ).json()) as AccountListResponse
        ).pagination.total,
      ).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });

  test('rejects empty, invalid, and protected patches without changing the account', async () => {
    const owner = await signedIn();
    const before = (
      (await (
        await create(owner.cookie, { name: 'Keep me', type: 'checking' })
      ).json()) as AccountResponse
    ).data;
    for (const body of [
      {},
      null,
      [],
      { name: '' },
      { name: ' \t' },
      { name: 'a'.repeat(101) },
      { name: null },
      { isArchived: 'false' },
      { isArchived: 0 },
      { isArchived: null },
      ...[
        'id',
        'userId',
        'user_id',
        'type',
        'currency',
        'openingBalance',
        'createdAt',
        'updatedAt',
        'tagIds',
      ].map((field) => ({ name: 'Attempted rename', [field]: 'blocked' })),
    ]) {
      const response = await patchAccount(owner.cookie, before.id, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'INVALID_INPUT' },
      });
    }
    expect(await (await detail(owner.cookie, before.id)).json()).toEqual({
      data: before,
    });
  });

  test('returns the same 404 for another user and a nonexistent account', async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const before = (
      (await (
        await create(owner.cookie, { name: 'Private', type: 'cash' })
      ).json()) as AccountResponse
    ).data;
    for (const id of [before.id, crypto.randomUUID()]) {
      const response = await patchAccount(other.cookie, id, {
        name: 'Stolen',
        isArchived: true,
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: 'NOT_FOUND', message: 'The account was not found.' },
      });
    }
    expect(await (await detail(owner.cookie, before.id)).json()).toEqual({
      data: before,
    });
  });

  test('requires an authenticated session and approved Origin before updating', async () => {
    const owner = await signedIn();
    const before = (
      (await (
        await create(owner.cookie, { name: 'Protected', type: 'cash' })
      ).json()) as AccountResponse
    ).data;
    expect(
      (await patchAccount(undefined, before.id, { isArchived: true })).status,
    ).toBe(401);
    expect(
      (await patchAccount('session=invalid', before.id, { isArchived: true }))
        .status,
    ).toBe(401);
    const update = spyOn(database, 'update');
    try {
      for (const originValue of [
        '',
        'null',
        'http://untrusted.example',
        origin + '/',
      ]) {
        const response = await patchAccount(
          owner.cookie,
          before.id,
          { isArchived: true },
          { Origin: originValue },
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: 'ORIGIN_REJECTED' },
        });
      }
      expect(update).not.toHaveBeenCalled();
    } finally {
      update.mockRestore();
    }
    expect(await (await detail(owner.cookie, before.id)).json()).toEqual({
      data: before,
    });
  });

  test('keeps JSON parsing, query fields, and parameter errors on the central error path', async () => {
    const owner = await signedIn();
    expect(
      (await patchAccount(owner.cookie, 'invalid-id', { isArchived: true }))
        .status,
    ).toBe(400);
    expect(
      (
        await patchAccount(
          owner.cookie,
          crypto.randomUUID() + '?archived=true',
          { isArchived: true },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await patchAccount(
          owner.cookie,
          crypto.randomUUID(),
          {},
          { 'Content-Type': 'text/plain' },
        )
      ).status,
    ).toBe(415);
    const response = await app.request(
      `/api/v1/accounts/${crypto.randomUUID()}`,
      {
        method: 'PATCH',
        headers: {
          Origin: origin,
          Cookie: owner.cookie,
          'Content-Type': 'application/json',
        },
        body: '{"private-input":',
      },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-input');
  });

  test('hides update failures and leaves the account unchanged', async () => {
    const owner = await signedIn();
    const before = (
      (await (
        await create(owner.cookie, { name: 'Original', type: 'checking' })
      ).json()) as AccountResponse
    ).data;
    const original = database.update.bind(database);
    const update = spyOn(database, 'update')
      .mockImplementationOnce(original)
      .mockImplementationOnce(() => {
        throw new Error('private-account-update');
      });
    try {
      const response = await patchAccount(owner.cookie, before.id, {
        name: 'Must not change',
        isArchived: true,
      });
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('private-account-update');
    } finally {
      update.mockRestore();
    }
    expect(await (await detail(owner.cookie, before.id)).json()).toEqual({
      data: before,
    });
  });

  test('waits for the account lock and preserves another committed field change', async () => {
    const owner = await signedIn();
    const before = (
      (await (
        await create(owner.cookie, { name: 'Original', type: 'cash' })
      ).json()) as AccountResponse
    ).data;
    let reached!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = database.transaction(async (tx) => {
      await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, before.id))
        .for('update');
      reached();
      await gate;
      await tx
        .update(accounts)
        .set({ name: 'Committed while patch waited' })
        .where(eq(accounts.id, before.id));
    });
    let pending: Promise<Response> | undefined;
    try {
      await locked;
      pending = patchAccount(owner.cookie, before.id, { isArchived: true });
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await database.execute(sql`
          select 1 from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and query like 'update "accounts"%'
        `);
        if (rows.length) {
          waiting = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(waiting).toBe(true);
      release();
      await holder;
      const response = await pending;
      expect(response.status).toBe(200);
      expect(((await response.json()) as AccountResponse).data).toMatchObject({
        name: 'Committed while patch waited',
        isArchived: true,
      });
    } finally {
      release();
      await holder;
      await pending;
    }
  });
});

describe('owned account deletion', () => {
  test.each([false, true])(
    'deletes an owned account with archive status %s and leaves other accounts and sessions intact',
    async (isArchived) => {
      const owner = await signedIn();
      const other = await signedIn();
      const target = (
        (await (
          await create(owner.cookie, {
            name: 'Delete this',
            type: 'credit',
            openingBalance: '-24.50',
          })
        ).json()) as AccountResponse
      ).data;
      if (isArchived) {
        expect(
          (await patchAccount(owner.cookie, target.id, { isArchived: true }))
            .status,
        ).toBe(200);
      }
      const sibling = (
        (await (
          await create(owner.cookie, { name: 'Keep this', type: 'cash' })
        ).json()) as AccountResponse
      ).data;
      const foreign = (
        (await (
          await create(other.cookie, { name: 'Another owner', type: 'cash' })
        ).json()) as AccountResponse
      ).data;
      const response = await removeAccount(owner.cookie, target.id);
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Set-Cookie')).toBe(false);
      expect((await detail(owner.cookie, target.id)).status).toBe(404);
      expect((await removeAccount(owner.cookie, target.id)).status).toBe(404);
      expect(await (await detail(owner.cookie, sibling.id)).json()).toEqual({
        data: sibling,
      });
      expect(await (await detail(other.cookie, foreign.id)).json()).toEqual({
        data: foreign,
      });
      const remaining = (await (
        await list(owner.cookie)
      ).json()) as AccountListResponse;
      expect(remaining.pagination.total).toBe(1);
      expect(remaining.data.map((account) => account.id)).toEqual([sibling.id]);
      expect(
        await database
          .select({ id: users.id })
          .from(users)
          .where(inArray(users.id, [owner.id, other.id])),
      ).toHaveLength(2);
      expect(
        await database
          .select({ id: sessions.id })
          .from(sessions)
          .where(inArray(sessions.userId, [owner.id, other.id])),
      ).toHaveLength(2);
    },
  );

  test('returns the same safe 404 for a foreign account and a missing ID', async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const target = (
      (await (
        await create(owner.cookie, {
          name: 'Private account',
          type: 'checking',
        })
      ).json()) as AccountResponse
    ).data;
    for (const id of [target.id, crypto.randomUUID()]) {
      const response = await removeAccount(other.cookie, id);
      expect(response.status).toBe(404);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        error: { code: 'NOT_FOUND', message: 'The account was not found.' },
      });
      expect(JSON.stringify(body)).not.toContain(target.name);
    }
    expect(await (await detail(owner.cookie, target.id)).json()).toEqual({
      data: target,
    });
  });

  test('rejects invalid or revoked sessions without deleting the account', async () => {
    const owner = await signedIn();
    const target = (
      (await (
        await create(owner.cookie, { name: 'Protected', type: 'checking' })
      ).json()) as AccountResponse
    ).data;
    for (const cookie of [
      undefined,
      'session=invalid',
      `session=${'a'.repeat(43)}`,
    ]) {
      expect((await removeAccount(cookie, target.id)).status).toBe(401);
    }
    await database.delete(sessions).where(eq(sessions.userId, owner.id));
    expect((await removeAccount(owner.cookie, target.id)).status).toBe(401);
    expect(
      await database
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, target.id)),
    ).toEqual([{ id: target.id }]);
  });

  test('rejects missing and unapproved origins before session or deletion work', async () => {
    const owner = await signedIn();
    const target = (
      (await (
        await create(owner.cookie, { name: 'Protected', type: 'cash' })
      ).json()) as AccountResponse
    ).data;
    const update = spyOn(database, 'update');
    const remove = spyOn(database, 'delete');
    try {
      const missing = await app.request(`/api/v1/accounts/${target.id}`, {
        method: 'DELETE',
        headers: { Cookie: owner.cookie },
      });
      expect(missing.status).toBe(403);
      for (const value of [
        '',
        'null',
        origin + '/',
        'http://untrusted.example',
      ]) {
        const response = await removeAccount(owner.cookie, target.id, {
          Origin: value,
        });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: 'ORIGIN_REJECTED' },
        });
      }
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally {
      update.mockRestore();
      remove.mockRestore();
    }
    expect((await detail(owner.cookie, target.id)).status).toBe(200);
  });

  test('rejects malformed IDs and unsupported query fields before deletion', async () => {
    const owner = await signedIn();
    const remove = spyOn(database, 'delete');
    try {
      for (const id of [
        'not-a-uuid',
        crypto.randomUUID() + '?userId=other',
        crypto.randomUUID() + '?archived=true',
      ]) {
        const response = await removeAccount(owner.cookie, id);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: 'INVALID_INPUT' },
        });
      }
      expect(remove).not.toHaveBeenCalled();
    } finally {
      remove.mockRestore();
    }
  });

  test('hides deletion failures and preserves the account for retry', async () => {
    const owner = await signedIn();
    const target = (
      (await (
        await create(owner.cookie, { name: 'Keep on failure', type: 'cash' })
      ).json()) as AccountResponse
    ).data;
    const remove = spyOn(database, 'delete').mockImplementation(() => {
      throw new Error('private-account-delete');
    });
    try {
      const response = await removeAccount(owner.cookie, target.id);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('private-account-delete');
    } finally {
      remove.mockRestore();
    }
    expect(await (await detail(owner.cookie, target.id)).json()).toEqual({
      data: target,
    });
    expect((await removeAccount(owner.cookie, target.id)).status).toBe(204);
  });
});

async function expectConstraintFailure(
  query: PromiseLike<unknown>,
  errno: string,
  constraint: string,
) {
  const failure: unknown = await Promise.resolve(query).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({ cause: { errno, constraint } });
}

describe('transaction references and retained history', () => {
  test('blocks deletion of an account with current transactions and allows archival', async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const account = (
      (await (
        await create(owner.cookie, { name: 'Used account', type: 'checking' })
      ).json()) as AccountResponse
    ).data;
    const [transaction] = await database
      .insert(transactions)
      .values({
        userId: owner.id,
        accountId: account.id,
        amount: '-24.50',
        occurredAt: new Date(),
      })
      .returning();
    for (const isArchived of [false, true]) {
      if (isArchived)
        expect(
          (await patchAccount(owner.cookie, account.id, { isArchived: true }))
            .status,
        ).toBe(200);
      const response = await removeAccount(owner.cookie, account.id);
      expect(response.status).toBe(409);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        error: {
          code: 'RESOURCE_IN_USE',
          message:
            'This account has transactions or history. Archive it instead.',
        },
      });
      expect(JSON.stringify(body)).not.toContain(
        'transactions_user_account_fk',
      );
      expect((await removeAccount(other.cookie, account.id)).status).toBe(404);
    }
    expect(
      await database
        .select()
        .from(transactions)
        .where(eq(transactions.id, transaction!.id)),
    ).toEqual([transaction!]);
    expect((await detail(owner.cookie, account.id)).status).toBe(200);
  });

  test('retains history after a current transaction is removed and still blocks account deletion', async () => {
    const owner = await signedIn();
    const account = (
      (await (
        await create(owner.cookie, { name: 'History account', type: 'cash' })
      ).json()) as AccountResponse
    ).data;
    const occurredAt = new Date();
    const [transaction] = await database
      .insert(transactions)
      .values({
        userId: owner.id,
        accountId: account.id,
        amount: '10.00',
        occurredAt,
      })
      .returning({ id: transactions.id });
    const snapshot = {
      id: transaction!.id,
      accountId: account.id,
      amount: '10.00',
      description: null,
      occurredAt: occurredAt.toISOString(),
      version: 1,
    };
    const [history] = await database
      .insert(transactionHistory)
      .values({
        userId: owner.id,
        transactionId: transaction!.id,
        accountId: account.id,
        version: 1,
        operation: 'create',
        snapshot,
        requestId: crypto.randomUUID(),
      })
      .returning();
    await database
      .delete(transactions)
      .where(eq(transactions.id, transaction!.id));
    expect(
      await database
        .select()
        .from(transactions)
        .where(eq(transactions.id, transaction!.id)),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(transactionHistory)
        .where(eq(transactionHistory.id, history!.id)),
    ).toEqual([history!]);
    const response = await removeAccount(owner.cookie, account.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'RESOURCE_IN_USE' },
    });
    expect(
      (await patchAccount(owner.cookie, account.id, { isArchived: true }))
        .status,
    ).toBe(200);
    expect((await detail(owner.cookie, account.id)).status).toBe(200);
  });

  test('rejects cross-owner account references in current transactions and history', async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const account = (
      (await (
        await create(owner.cookie, { name: 'Owned', type: 'cash' })
      ).json()) as AccountResponse
    ).data;
    await expectConstraintFailure(
      database.insert(transactions).values({
        userId: other.id,
        accountId: account.id,
        amount: '1.00',
        occurredAt: new Date(),
      }),
      '23503',
      'transactions_user_account_fk',
    );
    await expectConstraintFailure(
      database.insert(transactionHistory).values({
        userId: other.id,
        accountId: account.id,
        transactionId: crypto.randomUUID(),
        version: 1,
        operation: 'create',
        snapshot: { amount: '1.00' },
        requestId: crypto.randomUUID(),
      }),
      '23503',
      'transaction_history_user_account_fk',
    );
  });

  test('rejects zero/non-finite amounts and nonpositive transaction versions', async () => {
    const owner = await signedIn();
    const account = (
      (await (
        await create(owner.cookie, { name: 'Money rules', type: 'cash' })
      ).json()) as AccountResponse
    ).data;
    const base = {
      userId: owner.id,
      accountId: account.id,
      amount: '1.00',
      occurredAt: new Date(),
    };
    for (const amount of ['0.00', '-0.00', 'NaN']) {
      await expectConstraintFailure(
        database.insert(transactions).values({ ...base, amount }),
        '23514',
        'transactions_amount_valid',
      );
    }
    await expectConstraintFailure(
      database.insert(transactions).values({ ...base, version: 0 }),
      '23514',
      'transactions_version_positive',
    );
  });

  test('rejects duplicate history versions and invalid history metadata', async () => {
    const owner = await signedIn();
    const account = (
      (await (
        await create(owner.cookie, { name: 'History rules', type: 'cash' })
      ).json()) as AccountResponse
    ).data;
    const base = {
      userId: owner.id,
      accountId: account.id,
      transactionId: crypto.randomUUID(),
      version: 1,
      operation: 'create' as const,
      snapshot: { amount: '1.00' },
      requestId: crypto.randomUUID(),
    };
    await database.insert(transactionHistory).values(base);
    await expectConstraintFailure(
      database.insert(transactionHistory).values(base),
      '23505',
      'transaction_history_transaction_version_unique',
    );
    await expectConstraintFailure(
      database
        .insert(transactionHistory)
        .values({ ...base, transactionId: crypto.randomUUID(), version: 0 }),
      '23514',
      'transaction_history_version_positive',
    );
    await expectConstraintFailure(
      database.execute(sql`
      insert into transaction_history (user_id, account_id, transaction_id, version, operation, snapshot, request_id)
      values (${owner.id}, ${account.id}, ${crypto.randomUUID()}, 1, 'invalid', '{}'::jsonb, ${crypto.randomUUID()})
    `),
      '23514',
      'transaction_history_operation_supported',
    );
    await expectConstraintFailure(
      database.execute(sql`
      insert into transaction_history (user_id, account_id, transaction_id, version, operation, snapshot, request_id)
      values (${owner.id}, ${account.id}, ${crypto.randomUUID()}, 1, 'create', '[]'::jsonb, ${crypto.randomUUID()})
    `),
      '23514',
      'transaction_history_snapshot_object',
    );
  });
});

const input = { name: 'Daily account', type: 'checking' } as const;

describe('account input', () => {
  test('trims names and supplies currency and opening-balance defaults', () => {
    expect(
      v.parse(createAccountSchema, { ...input, name: '  Daily account  ' }),
    ).toEqual({
      ...input,
      currency: 'USD',
      openingBalance: '0.00',
    });
    expect(
      v.parse(createAccountSchema, { ...input, name: ` ${'a'.repeat(100)} ` })
        .name,
    ).toHaveLength(100);
  });

  test.each(['checking', 'savings', 'cash', 'credit', 'investment'])(
    'accepts type %s',
    (type) => {
      expect(v.safeParse(createAccountSchema, { ...input, type }).success).toBe(
        true,
      );
    },
  );
  test.each(['USD', 'EUR', 'GBP'])('accepts currency %s', (currency) => {
    expect(
      v.safeParse(createAccountSchema, { ...input, currency }).success,
    ).toBe(true);
  });
  test.each([
    '0.00',
    '0.01',
    '-0.01',
    '1500.00',
    '-24.50',
    '9999999999999999.99',
    '-9999999999999999.99',
  ])('accepts exact money %s', (openingBalance) => {
    expect(
      v.parse(createAccountSchema, { ...input, openingBalance }).openingBalance,
    ).toBe(openingBalance);
  });
  test.each([
    0,
    24.5,
    null,
    '',
    '1',
    '1.0',
    '1.000',
    '.50',
    '00.00',
    '01.00',
    '-0.00',
    '+1.00',
    '1e2',
    '1,000.00',
    'NaN',
    'Infinity',
    ' 1.00',
    '1.00 ',
    '1.00\n',
    '10000000000000000.00',
  ])('rejects invalid money %j', (openingBalance) => {
    expect(
      v.safeParse(createAccountSchema, { ...input, openingBalance }).success,
    ).toBe(false);
  });
  test.each<unknown>([
    {},
    { name: 'Name' },
    { type: 'checking' },
    { ...input, name: '' },
    { ...input, name: ' \t\n' },
    { ...input, name: 'a'.repeat(101) },
    { ...input, type: 'loan' },
    { ...input, currency: 'JPY' },
    { ...input, currency: 'usd' },
    ...[
      'userId',
      'user_id',
      'id',
      'isArchived',
      'createdAt',
      'updatedAt',
      'tagIds',
      'categoryId',
    ].map((field) => ({ ...input, [field]: 'not-allowed' })),
  ])('rejects missing, protected, and unsupported fields: %j', (value) => {
    expect(v.safeParse(createAccountSchema, value).success).toBe(false);
  });
  test('requires a UUID account ID', () => {
    expect(
      v.safeParse(accountIdSchema, { id: crypto.randomUUID() }).success,
    ).toBe(true);
    for (const id of ['not-a-uuid', '123', '', "' OR true --"]) {
      expect(v.safeParse(accountIdSchema, { id }).success).toBe(false);
    }
  });
});
