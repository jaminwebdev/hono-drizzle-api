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
