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
import { createApp } from '../../src/app';
import {
  accounts,
  sessions,
  transactionHistory,
  transactions,
  users,
} from '../../src/db/schema';
import { createTransactionSchema } from '../../src/features/transactions';
import { createTestDatabase } from './setup';

const database = createTestDatabase();
const origin = 'http://127.0.0.1:3002';
const ownedUsers: string[] = [];
const app = createApp(database, {
  APP_ENV: 'test',
  API_ORIGIN: origin,
  CORS_ORIGINS: [],
});
let log: ReturnType<typeof spyOn<typeof console, 'log'>>;

async function signedIn(isArchived = false) {
  const [user] = await database
    .insert(users)
    .values({
      email: `transaction-${crypto.randomUUID()}@example.test`,
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
  const [account] = await database
    .insert(accounts)
    .values({
      userId: user!.id,
      name: 'Checking',
      type: 'checking',
      currency: 'GBP',
      isArchived,
    })
    .returning({ id: accounts.id });
  return {
    id: user!.id,
    accountId: account!.id,
    cookie: `session=${credential}`,
  };
}

function create(
  cookie: string | undefined,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request('/api/v1/transactions', {
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
  return app.request(`/api/v1/transactions/${id}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

const sample = {
  accountId: '62a9b052-bb8a-49f8-935e-76f56b02e2db',
  amount: '-24.50',
  occurredAt: '2026-11-18',
};
type TransactionResponse = {
  data: {
    id: string;
    accountId: string;
    amount: string;
    description: string | null;
    occurredAt: string;
    version: number;
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

describe('transaction input', () => {
  test.each([
    '0.01',
    '-0.01',
    '12.00',
    '-24.50',
    '9999999999999999.99',
    '-9999999999999999.99',
  ])('keeps a valid signed amount exact: %s', (amount) => {
    expect(v.parse(createTransactionSchema, { ...sample, amount }).amount).toBe(
      amount,
    );
  });
  test.each([
    0,
    24.5,
    '',
    '0.00',
    '-0.00',
    '1',
    '1.0',
    '1.001',
    '.50',
    '01.00',
    '+1.00',
    '1e2',
    '1,000.00',
    'NaN',
    'Infinity',
    ' 1.00',
    '1.00\n',
    '10000000000000000.00',
  ])('rejects invalid money %j', (amount) => {
    expect(
      v.safeParse(createTransactionSchema, { ...sample, amount }).success,
    ).toBe(false);
  });
  test.each(['2026-11-19', '2024-02-29', '0001-01-01', '9999-12-31'])(
    'preserves a calendar date: %s',
    (occurredAt) => {
      expect(
        v.parse(createTransactionSchema, { ...sample, occurredAt }).occurredAt,
      ).toBe(occurredAt);
    },
  );
  test.each([
    '2026-11-18T18:00:00Z',
    '2026-11-18T10:00:00-08:00',
    '2026-02-30',
    '2025-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '2026-1-01',
    '0000-01-01',
    '10000-01-01',
    ' 2026-11-18',
    '2026-11-18\n',
    '',
    null,
    123,
    undefined,
  ])('rejects invalid or unsupported dates: %j', (occurredAt) => {
    expect(
      v.safeParse(createTransactionSchema, { ...sample, occurredAt }).success,
    ).toBe(false);
  });
  test('accepts a nullable or omitted description and rejects protected/future fields', () => {
    expect(
      v.safeParse(createTransactionSchema, { ...sample, description: null })
        .success,
    ).toBe(true);
    expect(
      v.safeParse(createTransactionSchema, {
        ...sample,
        description: 'a'.repeat(2000),
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(createTransactionSchema, {
        ...sample,
        description: 'a'.repeat(2001),
      }).success,
    ).toBe(false);
    for (const field of [
      'id',
      'userId',
      'user_id',
      'currency',
      'version',
      'createdAt',
      'updatedAt',
      'categoryId',
      'tagIds',
      'transferId',
      'direction',
    ]) {
      expect(
        v.safeParse(createTransactionSchema, {
          ...sample,
          [field]: 'forbidden',
        }).success,
      ).toBe(false);
    }
  });
});

describe('transaction creation and owned details', () => {
  test.each([
    '0.01',
    '-24.50',
    '1500.00',
    '9999999999999999.99',
    '-9999999999999999.99',
  ])(
    'commits exact money and an initial snapshot together: %s',
    async (amount) => {
      const owner = await signedIn();
      const response = await create(owner.cookie, {
        ...sample,
        accountId: owner.accountId,
        amount,
        description: 'Groceries',
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as TransactionResponse;
      expect(body.data).toEqual({
        id: body.data.id,
        accountId: owner.accountId,
        amount,
        description: 'Groceries',
        occurredAt: '2026-11-18',
        version: 1,
        createdAt: body.data.createdAt,
        updatedAt: body.data.updatedAt,
      });
      expect(new Date(body.data.createdAt).toISOString()).toBe(
        body.data.createdAt,
      );
      expect(body.data.updatedAt).toBe(body.data.createdAt);
      expect(response.headers.get('Location')).toBe(
        `/api/v1/transactions/${body.data.id}`,
      );
      expect(response.headers.get('ETag')).toBe('"1"');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      const [stored] = await database
        .select({ owner: transactions.userId })
        .from(transactions)
        .where(eq(transactions.id, body.data.id));
      expect(stored!.owner).toBe(owner.id);
      const history = await database
        .select()
        .from(transactionHistory)
        .where(eq(transactionHistory.transactionId, body.data.id));
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        userId: owner.id,
        accountId: owner.accountId,
        version: 1,
        operation: 'create',
        requestId: response.headers.get('X-Request-Id'),
        snapshot: {
          ...body.data,
          account: { id: owner.accountId, name: 'Checking', currency: 'GBP' },
        },
      });
      const fetched = await detail(owner.cookie, body.data.id);
      expect(fetched.status).toBe(200);
      expect(fetched.headers.get('ETag')).toBe('"1"');
      expect(await fetched.json()).toEqual(body);
      expect(JSON.stringify(log.mock.calls)).not.toContain(owner.cookie);
    },
  );

  test.each(['0001-01-01', '2024-02-29', '9999-12-31'])(
    'stores and returns the same calendar date: %s',
    async (occurredAt) => {
      const owner = await signedIn();
      const response = await create(owner.cookie, {
        ...sample,
        accountId: owner.accountId,
        occurredAt,
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as TransactionResponse;
      expect(body.data.occurredAt).toBe(occurredAt);
      const fetched = await detail(owner.cookie, body.data.id);
      expect(
        ((await fetched.json()) as TransactionResponse).data.occurredAt,
      ).toBe(occurredAt);
      const [history] = await database
        .select()
        .from(transactionHistory)
        .where(eq(transactionHistory.transactionId, body.data.id));
      expect(history!.snapshot.occurredAt).toBe(occurredAt);
    },
  );

  test('stores omitted descriptions as null and creates a new record on repeated POSTs', async () => {
    const owner = await signedIn();
    const input = { ...sample, accountId: owner.accountId };
    const first = await create(owner.cookie, input);
    const second = await create(owner.cookie, input);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json()) as TransactionResponse;
    const b = (await second.json()) as TransactionResponse;
    expect(a.data.description).toBeNull();
    expect(a.data.id).not.toBe(b.data.id);
    expect(
      await database
        .select({ id: transactionHistory.id })
        .from(transactionHistory)
        .where(eq(transactionHistory.userId, owner.id)),
    ).toHaveLength(2);
  });

  test('rejects owned archived accounts while missing and foreign accounts share a 404', async () => {
    const owner = await signedIn();
    const archived = await signedIn(true);
    for (const accountId of [archived.accountId, crypto.randomUUID()]) {
      const response = await create(owner.cookie, { ...sample, accountId });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: 'NOT_FOUND', message: 'The account was not found.' },
      });
    }
    const response = await create(archived.cookie, {
      ...sample,
      accountId: archived.accountId,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: 'ACCOUNT_ARCHIVED' },
    });
    expect(
      await database
        .select()
        .from(transactions)
        .where(inArray(transactions.userId, [owner.id, archived.id])),
    ).toEqual([]);
  });

  test("hides another user's transaction and still reads an archived account's existing transaction", async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const created = await create(owner.cookie, {
      ...sample,
      accountId: owner.accountId,
    });
    const { data } = (await created.json()) as TransactionResponse;
    await database
      .update(accounts)
      .set({ isArchived: true })
      .where(eq(accounts.id, owner.accountId));
    for (const id of [data.id, crypto.randomUUID()]) {
      const response = await detail(other.cookie, id);
      expect(response.status).toBe(404);
      expect(response.headers.has('ETag')).toBe(false);
      expect(await response.json()).toMatchObject({
        error: { code: 'NOT_FOUND', message: 'The transaction was not found.' },
      });
    }
    expect((await detail(owner.cookie, data.id)).status).toBe(200);
  });

  test('requires authentication and rejects unapproved Origin before store access', async () => {
    expect((await create(undefined, sample)).status).toBe(401);
    expect((await detail(undefined, crypto.randomUUID())).status).toBe(401);
    expect((await create('session=invalid', sample)).status).toBe(401);
    const update = spyOn(database, 'update');
    try {
      for (const value of ['', 'null', 'http://untrusted.example']) {
        const response = await create(undefined, sample, { Origin: value });
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: 'ORIGIN_REJECTED' },
        });
      }
      expect(update).not.toHaveBeenCalled();
    } finally {
      update.mockRestore();
    }
  });

  test('validates bodies, IDs, and queries before starting a transaction', async () => {
    const owner = await signedIn();
    const transaction = spyOn(database, 'transaction');
    try {
      for (const body of [
        {},
        { ...sample, amount: '0.00' },
        { ...sample, amount: 12.5 },
        { ...sample, occurredAt: '2026-02-30' },
        ...[
          'userId',
          'version',
          'categoryId',
          'tagIds',
          'currency',
          'transferId',
        ].map((field) => ({ ...sample, [field]: 'forbidden' })),
      ]) {
        const response = await create(owner.cookie, body);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: 'INVALID_INPUT' },
        });
      }
      expect(
        (await create(owner.cookie, sample, { 'Content-Type': 'text/plain' }))
          .status,
      ).toBe(415);
      expect((await detail(owner.cookie, 'invalid-id')).status).toBe(400);
      expect(
        (await detail(owner.cookie, crypto.randomUUID() + '?userId=other'))
          .status,
      ).toBe(400);
      const malformed = await app.request('/api/v1/transactions', {
        method: 'POST',
        headers: {
          Origin: origin,
          Cookie: owner.cookie,
          'Content-Type': 'application/json',
        },
        body: '{"private-input":',
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.text()).not.toContain('private-input');
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });

  test('rolls back the inserted current transaction when its history write fails', async () => {
    const owner = await signedIn();
    const original = database.transaction.bind(database);
    const transaction = spyOn(database, 'transaction').mockImplementation(
      (callback) =>
        original(async (tx) => {
          const realInsert = tx.insert.bind(tx);
          const insert = spyOn(tx, 'insert')
            .mockImplementationOnce(realInsert)
            .mockImplementationOnce(() => {
              throw new Error('private-snapshot-failure');
            });
          try {
            return await callback(tx);
          } finally {
            insert.mockRestore();
          }
        }),
    );
    try {
      const response = await create(owner.cookie, {
        ...sample,
        accountId: owner.accountId,
      });
      expect(response.status).toBe(500);
      expect(response.headers.has('Location')).toBe(false);
      expect(response.headers.has('ETag')).toBe(false);
      expect(await response.text()).not.toContain('private-snapshot-failure');
    } finally {
      transaction.mockRestore();
    }
    expect(
      await database
        .select()
        .from(transactions)
        .where(eq(transactions.userId, owner.id)),
    ).toEqual([]);
    expect(
      await database
        .select()
        .from(transactionHistory)
        .where(eq(transactionHistory.userId, owner.id)),
    ).toEqual([]);
  });

  test('waits for archival to commit and rejects creation against the now-archived account', async () => {
    const owner = await signedIn();
    let reached!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const archival = database.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ isArchived: true })
        .where(eq(accounts.id, owner.accountId));
      reached();
      await gate;
    });
    let pending: ReturnType<typeof create> | undefined;
    try {
      await locked;
      pending = create(owner.cookie, { ...sample, accountId: owner.accountId });
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await database.execute(
          sql`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like 'select%from "accounts"%for update%'`,
        );
        if (rows.length) {
          waiting = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(waiting).toBe(true);
      release();
      await archival;
      const response = await pending;
      expect(response.status).toBe(409);
      expect(
        await database
          .select()
          .from(transactions)
          .where(eq(transactions.userId, owner.id)),
      ).toEqual([]);
    } finally {
      release();
      await archival;
      await pending;
    }
  });
});

function patch(
  cookie: string | undefined,
  id: string,
  body: unknown,
  version?: string,
) {
  return app.request(`/api/v1/transactions/${id}`, {
    method: 'PATCH',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(version === undefined ? {} : { 'If-Match': version }),
    },
    body: JSON.stringify(body),
  });
}
function history(cookie: string | undefined, id: string, query = '') {
  return app.request(`/api/v1/transactions/${id}/history${query}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}
type HistoryResponse = {
  data: {
    id: string;
    transactionId: string;
    accountId: string;
    version: number;
    operation: string;
    snapshot: Record<string, unknown>;
    requestId: string;
    recordedAt: string;
  }[];
  pagination: { page: number; limit: number; total: number };
};
async function existing() {
  const owner = await signedIn();
  const response = await create(owner.cookie, {
    ...sample,
    accountId: owner.accountId,
    description: 'Original',
  });
  expect(response.status).toBe(201);
  return {
    ...owner,
    transaction: ((await response.json()) as TransactionResponse).data,
  };
}

describe('transaction corrections and history', () => {
  test('updates allowed fields, preserves original facts, and appends snapshots with current account context', async () => {
    const owner = await existing();
    await database
      .update(accounts)
      .set({ isArchived: true, name: 'Renamed' })
      .where(eq(accounts.id, owner.accountId));
    const response = await patch(
      owner.cookie,
      owner.transaction.id,
      {
        amount: '150.00',
        description: null,
        occurredAt: '2024-02-29',
      },
      '"1"',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBe('"2"');
    const { data } = (await response.json()) as TransactionResponse;
    expect(data).toEqual({
      ...owner.transaction,
      amount: '150.00',
      description: null,
      occurredAt: '2024-02-29',
      version: 2,
      updatedAt: data.updatedAt,
    });
    expect(new Date(data.updatedAt).toISOString()).toBe(data.updatedAt);
    expect(Date.parse(data.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(data.createdAt),
    );
    const result = await history(owner.cookie, data.id);
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    const body = (await result.json()) as HistoryResponse;
    expect(body.pagination).toEqual({ page: 1, limit: 25, total: 2 });
    expect(body.data.map((row) => row.version)).toEqual([2, 1]);
    expect(body.data[0]).toEqual({
      id: body.data[0]!.id,
      transactionId: data.id,
      accountId: owner.accountId,
      version: 2,
      operation: 'update',
      requestId: response.headers.get('X-Request-Id')!,
      recordedAt: body.data[0]!.recordedAt,
      snapshot: {
        ...data,
        account: { id: owner.accountId, name: 'Renamed', currency: 'GBP' },
      },
    });
    expect(body.data[1]!.snapshot).toEqual({
      ...owner.transaction,
      account: { id: owner.accountId, name: 'Checking', currency: 'GBP' },
    });
    const partial = await patch(
      owner.cookie,
      data.id,
      { description: 'Corrected' },
      '"2"',
    );
    expect(partial.status).toBe(200);
    expect(partial.headers.get('ETag')).toBe('"3"');
    expect(((await partial.json()) as TransactionResponse).data).toMatchObject({
      amount: '150.00',
      occurredAt: '2024-02-29',
      description: 'Corrected',
      version: 3,
    });
    expect((await detail(owner.cookie, data.id)).headers.get('ETag')).toBe(
      '"3"',
    );
  });

  test('rejects missing, malformed, and stale preconditions without changing current data or history', async () => {
    const owner = await existing();
    for (const [version, status, code] of [
      [undefined, 428, 'PRECONDITION_REQUIRED'],
      ['', 400, 'INVALID_INPUT'],
      ['1', 400, 'INVALID_INPUT'],
      ['W/"1"', 400, 'INVALID_INPUT'],
      ['*', 400, 'INVALID_INPUT'],
      ['"1", "2"', 400, 'INVALID_INPUT'],
      ['"01"', 400, 'INVALID_INPUT'],
      ['"0"', 400, 'INVALID_INPUT'],
      ['"-1"', 400, 'INVALID_INPUT'],
      ['"2147483648"', 400, 'INVALID_INPUT'],
      ['"2"', 412, 'VERSION_MISMATCH'],
    ] as const) {
      const response = await patch(
        owner.cookie,
        owner.transaction.id,
        { amount: '2.00' },
        version,
      );
      expect(response.status).toBe(status);
      expect(response.headers.has('ETag')).toBe(false);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    expect(
      (
        (await (
          await detail(owner.cookie, owner.transaction.id)
        ).json()) as TransactionResponse
      ).data,
    ).toEqual(owner.transaction);
    expect(
      (
        (await (
          await history(owner.cookie, owner.transaction.id)
        ).json()) as HistoryResponse
      ).pagination.total,
    ).toBe(1);
  });

  test('returns the same 404 for foreign and missing IDs before checking version headers', async () => {
    const owner = await existing();
    const other = await signedIn();
    for (const id of [owner.transaction.id, crypto.randomUUID()]) {
      for (const version of [undefined, 'invalid', '"999"']) {
        const response = await patch(
          other.cookie,
          id,
          { description: 'private' },
          version,
        );
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({
          error: {
            code: 'NOT_FOUND',
            message: 'The transaction was not found.',
          },
        });
      }
      expect((await history(other.cookie, id)).status).toBe(404);
    }
  });

  test('rejects empty, protected, and invalid patches before opening a transaction', async () => {
    const owner = await existing();
    const transaction = spyOn(database, 'transaction');
    try {
      for (const body of [
        {},
        null,
        [],
        { amount: '0.00' },
        { amount: 12 },
        { amount: null },
        { occurredAt: '2026-02-30' },
        { occurredAt: '2026-11-19T00:00:00Z' },
        { occurredAt: null },
        { description: 'x'.repeat(2001) },
        ...[
          'accountId',
          'userId',
          'id',
          'version',
          'createdAt',
          'updatedAt',
          'tagIds',
          'categoryId',
          'currency',
          'transferId',
        ].map((key) => ({ description: 'private', [key]: owner.accountId })),
      ]) {
        const response = await patch(
          owner.cookie,
          owner.transaction.id,
          body,
          '"1"',
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          error: { code: 'INVALID_INPUT' },
        });
      }
      expect(
        (await patch(owner.cookie, 'invalid-id', { amount: '1.00' }, '"1"'))
          .status,
      ).toBe(400);
      expect(
        (
          await patch(
            owner.cookie,
            owner.transaction.id + '?q=x',
            { amount: '1.00' },
            '"1"',
          )
        ).status,
      ).toBe(400);
      const malformed = await app.request(
        `/api/v1/transactions/${owner.transaction.id}`,
        {
          method: 'PATCH',
          headers: {
            Origin: origin,
            Cookie: owner.cookie,
            'Content-Type': 'application/json',
            'If-Match': '"1"',
          },
          body: '{"private-value":',
        },
      );
      expect(malformed.status).toBe(400);
      expect(await malformed.text()).not.toContain('private-value');
      const wrongType = await app.request(
        `/api/v1/transactions/${owner.transaction.id}`,
        {
          method: 'PATCH',
          headers: {
            Origin: origin,
            Cookie: owner.cookie,
            'Content-Type': 'text/plain',
          },
          body: '{}',
        },
      );
      expect(wrongType.status).toBe(415);
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });

  test('allows one concurrent correction and rejects the other stale version', async () => {
    const owner = await existing();
    const responses = await Promise.all([
      patch(owner.cookie, owner.transaction.id, { amount: '10.00' }, '"1"'),
      patch(owner.cookie, owner.transaction.id, { amount: '20.00' }, '"1"'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 412,
    ]);
    const winner = (await responses
      .find((response) => response.status === 200)!
      .json()) as TransactionResponse;
    const result = (await (
      await history(owner.cookie, owner.transaction.id)
    ).json()) as HistoryResponse;
    expect(result.data.map((row) => row.version)).toEqual([2, 1]);
    expect(result.data[0]!.snapshot.amount).toBe(winner.data.amount);
    expect(
      (
        (await (
          await detail(owner.cookie, owner.transaction.id)
        ).json()) as TransactionResponse
      ).data,
    ).toEqual(winner.data);
  });

  test('rolls back the updated fields, timestamp, and version if history insertion fails', async () => {
    const owner = await existing();
    const original = database.transaction.bind(database);
    const transaction = spyOn(database, 'transaction').mockImplementation(
      (callback) =>
        original(async (tx) => {
          const insert = spyOn(tx, 'insert').mockImplementation(() => {
            throw new Error('private-history-passwordHash');
          });
          try {
            return await callback(tx);
          } finally {
            insert.mockRestore();
          }
        }),
    );
    try {
      const response = await patch(
        owner.cookie,
        owner.transaction.id,
        { amount: '99.00' },
        '"1"',
      );
      expect(response.status).toBe(500);
      expect(response.headers.has('ETag')).toBe(false);
      const text = await response.text();
      expect(text).not.toContain('private-history');
      expect(text).not.toContain('passwordHash');
      expect(text).not.toContain(owner.cookie);
    } finally {
      transaction.mockRestore();
    }
    expect(
      (
        (await (
          await detail(owner.cookie, owner.transaction.id)
        ).json()) as TransactionResponse
      ).data,
    ).toEqual(owner.transaction);
    expect(
      (
        (await (
          await history(owner.cookie, owner.transaction.id)
        ).json()) as HistoryResponse
      ).pagination.total,
    ).toBe(1);
  });

  test('paginates newest versions first with strict query bounds and no foreign data', async () => {
    const owner = await existing();
    await patch(
      owner.cookie,
      owner.transaction.id,
      { description: 'Second' },
      '"1"',
    );
    await patch(
      owner.cookie,
      owner.transaction.id,
      { description: 'Third' },
      '"2"',
    );
    const response = await history(
      owner.cookie,
      owner.transaction.id,
      '?page=2&limit=1',
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as HistoryResponse;
    expect(body.pagination).toEqual({ page: 2, limit: 1, total: 3 });
    expect(body.data.map((row) => row.version)).toEqual([2]);
    expect(JSON.stringify(body)).not.toContain('userId');
    const beyond = (await (
      await history(owner.cookie, owner.transaction.id, '?page=10001&limit=1')
    ).json()) as HistoryResponse;
    expect(beyond).toEqual({
      data: [],
      pagination: { page: 10001, limit: 1, total: 3 },
    });
    expect(
      (await history(owner.cookie, owner.transaction.id, '?limit=100')).status,
    ).toBe(200);
    for (const query of [
      '?page=0',
      '?limit=101',
      '?page=10002&limit=1',
      '?page=102&limit=100',
      '?page=1&page=2',
      '?limit=1&limit=2',
      '?page=1.5',
      '?limit=-1',
      '?limit=01',
      '?userId=x',
      '?q=x',
    ]) {
      expect(
        (await history(owner.cookie, owner.transaction.id, query)).status,
      ).toBe(400);
    }
    expect((await history(owner.cookie, 'invalid-id')).status).toBe(400);
  });

  test('returns empty history for an owned current row without history and hides missing rows', async () => {
    const owner = await signedIn();
    const [row] = await database
      .insert(transactions)
      .values({
        userId: owner.id,
        accountId: owner.accountId,
        amount: '1.00',
        occurredAt: '2026-11-19',
      })
      .returning({ id: transactions.id });
    const response = await history(owner.cookie, row!.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [],
      pagination: { page: 1, limit: 25, total: 0 },
    });
    expect((await history(owner.cookie, crypto.randomUUID())).status).toBe(404);
  });

  test('requires sessions for correction and history and rejects write origins', async () => {
    const owner = await existing();
    expect(
      (await patch(undefined, owner.transaction.id, { amount: '1.00' }, '"1"'))
        .status,
    ).toBe(401);
    expect((await history(undefined, owner.transaction.id)).status).toBe(401);
    expect(
      (await history('session=invalid', owner.transaction.id)).status,
    ).toBe(401);
    const transaction = spyOn(database, 'transaction');
    try {
      for (const value of ['', 'null', 'http://untrusted.example']) {
        const response = await app.request(
          `/api/v1/transactions/${owner.transaction.id}`,
          {
            method: 'PATCH',
            headers: {
              Origin: value,
              Cookie: owner.cookie,
              'Content-Type': 'application/json',
              'If-Match': '"1"',
            },
            body: '{"amount":"1.00"}',
          },
        );
        expect(response.status).toBe(403);
      }
      await database.delete(sessions).where(eq(sessions.userId, owner.id));
      expect(
        (
          await patch(
            owner.cookie,
            owner.transaction.id,
            { amount: '1.00' },
            '"1"',
          )
        ).status,
      ).toBe(401);
      expect((await history(owner.cookie, owner.transaction.id)).status).toBe(
        401,
      );
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });
});
