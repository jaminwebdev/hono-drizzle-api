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
