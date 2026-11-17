import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import * as v from 'valibot';
import {
  accountIdSchema,
  createAccountSchema,
} from '../../src/features/accounts';
import { createApp } from '../../src/app';
import { accounts, sessions, users } from '../../src/db/schema';
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
function detail(cookie: string | undefined, id: string) {
  return app.request(`/api/v1/accounts/${id}`, {
    headers: cookie ? { Cookie: cookie } : {},
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
