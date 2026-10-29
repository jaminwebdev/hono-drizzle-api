import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import * as v from 'valibot';
import { createApp } from '../../src/app';
import { users } from '../../src/db/schema';
import { registrationSchema } from '../../src/features/auth';
import { createTestDatabase } from './setup';

const database = createTestDatabase();
const origin = 'http://127.0.0.1:3002';
const password = '  a learning passphrase 🐢  ';
const emails = new Set<string>();
let log: ReturnType<typeof spyOn<typeof console, 'log'>>;

function email() {
  const value = `auth-test-${crypto.randomUUID()}@example.test`;
  emails.add(value);
  return value;
}

function fixture() {
  return createApp(database, { API_ORIGIN: origin, CORS_ORIGINS: [] });
}

async function register(app: ReturnType<typeof fixture>, body: unknown, address = '192.0.2.1', headers = {}) {
  return app.request('/api/v1/auth/register', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, { requestIP: () => ({ address, family: 'IPv4', port: 12345 }) });
}

beforeEach(() => { log = spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(async () => {
  log.mockRestore();
  if (emails.size) await database.delete(users).where(inArray(users.email, [...emails]));
  emails.clear();
});
afterAll(async () => { await database.$client.close(); });

describe('registration input', () => {
  test('normalizes only email and preserves the complete password', () => {
    const result = v.parse(registrationSchema, { email: '  LEARNER+LABEL@Example.Test  ', password });
    expect(result).toEqual({ email: 'learner+label@example.test', password });
  });

  test.each([15, 128])('accepts a password with %s Unicode code points', (length) => {
    expect(v.safeParse(registrationSchema, { email: email(), password: '🐢'.repeat(length) }).success).toBe(true);
  });

  test.each([14, 129])('rejects a password with %s Unicode code points', (length) => {
    expect(v.safeParse(registrationSchema, { email: email(), password: '🐢'.repeat(length) }).success).toBe(false);
  });

  test.each([
    null, [], {}, { email: 'not-an-email', password }, { email: 'a'.repeat(243) + '@example.test', password },
    { email: 'learner@example.test', password: 123456789012345 },
    { email: 'learner@example.test', password: 'PASSWORDPASSWORD' },
    { email: 'learner@example.test', password, userId: crypto.randomUUID() },
  ].map((body) => ({ body })))('rejects invalid or extra fields', ({ body }) => {
    expect(v.safeParse(registrationSchema, body).success).toBe(false);
  });
});

describe('registration endpoint', () => {
  test('stores an Argon2id hash and returns only the ID and normalized email without logging credentials', async () => {
    const address = email();
    const response = await register(fixture(), { email: `  ${address.toUpperCase()}  `, password });
    expect(response.status).toBe(201);
    const body = await response.json() as { data: { id: string; email: string } };
    expect(body).toEqual({ data: { id: expect.any(String) as string, email: address } });
    expect(body.data.id).toMatch(/^[a-f\d-]{36}$/);
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(response.headers.has('Location')).toBe(false);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [stored] = await database.select().from(users).where(inArray(users.email, [address]));
    expect(stored?.passwordHash).toStartWith('$argon2id$v=19$m=19456,t=2,p=1$');
    expect(await Bun.password.verify(password, stored!.passwordHash)).toBe(true);
    expect(await Bun.password.verify(password.trim(), stored!.passwordHash)).toBe(false);
    const output = JSON.stringify(log.mock.calls);
    for (const secret of [password, address, stored!.passwordHash]) expect(output).not.toContain(secret);
  });

  test('allows one of two concurrent registrations for the same normalized email', async () => {
    const address = email();
    const app = fixture();
    const responses = await Promise.all([
      register(app, { email: address, password }),
      register(app, { email: address.toUpperCase(), password }, '192.0.2.2'),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const conflict = responses.find((response) => response.status === 409)!;
    expect(await conflict.json()).toMatchObject({ error: { code: 'ACCOUNT_NOT_AVAILABLE', status: 409 } });
    expect(JSON.stringify(log.mock.calls)).not.toContain(address);
    const rows = await database.select({ id: users.id }).from(users).where(inArray(users.email, [address]));
    expect(rows).toHaveLength(1);
  });

  test('rejects invalid input before hashing or writing and keeps submitted values out of errors', async () => {
    const address = email();
    const hash = spyOn(Bun.password, 'hash');
    try {
      const response = await register(fixture(), { email: address, password: 'short-secret' });
      expect(response.status).toBe(400);
      const body = await response.text();
      expect(body).not.toContain(address);
      expect(body).not.toContain('short-secret');
      expect(hash).not.toHaveBeenCalled();
      expect(await database.select({ id: users.id }).from(users).where(inArray(users.email, [address]))).toHaveLength(0);
    } finally { hash.mockRestore(); }
  });

  test('applies shared origin and JSON checks before password work', async () => {
    const hash = spyOn(Bun.password, 'hash');
    try {
      const app = fixture();
      expect((await register(app, { email: email(), password }, '192.0.2.1', { Origin: 'http://untrusted.example' })).status).toBe(403);
      expect((await register(app, {}, '192.0.2.1', { 'Content-Type': 'text/plain' })).status).toBe(415);
      expect(hash).not.toHaveBeenCalled();
    } finally { hash.mockRestore(); }
  });

  test('fails safely when the connection has no peer address', async () => {
    const response = await fixture().request('/api/v1/auth/register', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
    }, { requestIP: () => null });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
  });

  test('hides unexpected database failures without retrying the insert', async () => {
    const insert = spyOn(database, 'insert').mockImplementation(() => { throw new Error('synthetic-private-database-error'); });
    try {
      const response = await register(fixture(), { email: email(), password });
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(body).not.toContain('synthetic-private-database-error');
      expect(body).toContain('INTERNAL_ERROR');
      expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-private-database-error');
      expect(insert).toHaveBeenCalledTimes(1);
    } finally { insert.mockRestore(); }
  });
});

describe('registration limits', () => {
  test('counts invalid attempts, ignores forwarded IPs, and allows a fresh window after an hour', async () => {
    const app = fixture();
    const clock = spyOn(Date, 'now').mockReturnValue(1000);
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        expect((await register(app, {}, '192.0.2.1', { 'X-Forwarded-For': `198.51.100.${attempt}` })).status).toBe(400);
      }
      const blocked = await register(app, {});
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('Retry-After')).toBe('3600');
      expect((await register(app, {}, '192.0.2.2')).status).toBe(400);
      clock.mockReturnValue(3_601_000);
      expect((await register(app, {})).status).toBe(400);
    } finally { clock.mockRestore(); }
  });

  test('caps stored peer entries and reclaims expired capacity', async () => {
    const app = fixture();
    const clock = spyOn(Date, 'now').mockReturnValue(1000);
    try {
      for (let index = 0; index < 1024; index++) {
        const peer = `198.18.${Math.floor(index / 256)}.${index % 256}`;
        expect((await register(app, {}, peer)).status).toBe(400);
      }
      const full = await register(app, {}, '192.0.2.99');
      expect(full.status).toBe(429);
      expect(full.headers.get('Retry-After')).toBe('60');
      clock.mockReturnValue(3_601_000);
      expect((await register(app, {}, '192.0.2.99')).status).toBe(400);
    } finally { clock.mockRestore(); }
  });

  test('allows at most two pending hashes and releases capacity after a hash failure', async () => {
    const app = fixture();
    const rejectHashes: Array<(reason: Error) => void> = [];
    const hash = spyOn(Bun.password, 'hash').mockImplementation(() => new Promise<string>((_resolve, reject) => {
      rejectHashes.push(reject);
    }));
    const pending: Array<Promise<Response>> = [];
    try {
      pending.push(register(app, { email: email(), password }, '192.0.2.1'));
      pending.push(register(app, { email: email(), password }, '192.0.2.2'));
      await Bun.sleep(0);
      expect(hash).toHaveBeenCalledTimes(2);
      const blocked = await register(app, { email: email(), password }, '192.0.2.3');
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('Retry-After')).toBe('1');
      rejectHashes.splice(0).forEach((reject) => reject(new Error('synthetic-private-hash-failure')));
      const failures = await Promise.all(pending);
      for (const response of failures) {
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain('synthetic-private-hash-failure');
      }
      hash.mockRestore();
      expect((await register(app, { email: email(), password }, '192.0.2.4')).status).toBe(201);
    } finally {
      rejectHashes.forEach((reject) => reject(new Error('Test cleanup.')));
      await Promise.all(pending);
      hash.mockRestore();
    }
  });
});
