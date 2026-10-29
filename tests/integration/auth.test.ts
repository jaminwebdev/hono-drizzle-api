import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import * as v from 'valibot';
import { createApp } from '../../src/app';
import { sessions, users } from '../../src/db/schema';
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

function fixture(mode: 'local' | 'test' | 'production' = 'test') {
  return createApp(database, {
    APP_ENV: mode, API_ORIGIN: mode === 'production' ? 'https://api.example.test' : origin, CORS_ORIGINS: [],
  });
}

async function register(app: ReturnType<typeof fixture>, body: unknown, address = '192.0.2.1', headers = {}) {
  return app.request('/api/v1/auth/register', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, { requestIP: () => ({ address, family: 'IPv4', port: 12345 }) });
}

async function login(app: ReturnType<typeof fixture>, body: unknown, address = '192.0.2.1', headers = {}) {
  return app.request('/api/v1/auth/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }, { requestIP: () => ({ address, family: 'IPv4', port: 12345 }) });
}

async function seedUser() {
  const passwordHash = await Bun.password.hash(password, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 });
  const [user] = await database.insert(users).values({ email: email(), passwordHash }).returning();
  return user!;
}

function credential(response: Response) {
  const value = response.headers.get('Set-Cookie')?.match(/^session=([^;]+)/)?.[1];
  expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return value!;
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
    const verify = spyOn(Bun.password, 'verify');
    try {
      const app = fixture();
      expect((await register(app, { email: email(), password }, '192.0.2.1', { Origin: 'http://untrusted.example' })).status).toBe(403);
      expect((await register(app, {}, '192.0.2.1', { 'Content-Type': 'text/plain' })).status).toBe(415);
      expect((await login(app, { email: email(), password }, '192.0.2.1', { Origin: 'http://untrusted.example' })).status).toBe(403);
      expect((await login(app, {}, '192.0.2.1', { 'Content-Type': 'text/plain' })).status).toBe(415);
      expect(hash).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
    } finally { hash.mockRestore(); verify.mockRestore(); }
  });

  test.each(['register', 'login'])('fails safely when %s has no peer address', async (route) => {
    const response = await fixture().request(`/api/v1/auth/${route}`, {
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
      expect(await blocked.json()).toMatchObject({ error: {
        status: 429, code: 'RATE_LIMITED', requestId: blocked.headers.get('X-Request-Id'),
      } });
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
      expect(await full.json()).toMatchObject({ error: {
        status: 429, code: 'RATE_LIMITED', requestId: full.headers.get('X-Request-Id'),
      } });
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
      expect(await blocked.json()).toMatchObject({ error: {
        status: 429, code: 'RATE_LIMITED', requestId: blocked.headers.get('X-Request-Id'),
      } });
      expect((await login(app, { email: email(), password })).status).toBe(429);
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

describe('login endpoint', () => {
  test.each(['local', 'test', 'production'] as const)('issues the %s cookie and stores only its credential hash', async (mode) => {
    const user = await seedUser();
    const started = Date.now();
    const response = await login(fixture(mode), { email: ` ${user.email.toUpperCase()} `, password }, '192.0.2.1', {
      Origin: mode === 'production' ? 'https://api.example.test' : origin,
    });
    expect(response.status).toBe(200);
    const token = credential(response);
    const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=604800');
    expect(/; Secure(?:;|$)/.test(cookie)).toBe(mode === 'production');
    expect(cookie).not.toContain('Domain=');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body: unknown = await response.json();
    expect(body).toEqual({ data: { id: user.id, email: user.email } });
    const [session] = await database.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(session?.tokenHash).toBe(new Bun.CryptoHasher('sha256').update(token).digest('hex'));
    expect(session?.tokenHash).not.toBe(token);
    expect(session!.expiresAt.getTime()).toBeGreaterThanOrEqual(started + 604800_000);
    expect(session!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 604800_000);
    const output = JSON.stringify({ body, logs: log.mock.calls });
    for (const secret of [password, user.passwordHash, token, session!.tokenHash]) expect(output).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain(user.email);
  });

  test('creates independent credentials and ignores a preexisting client cookie', async () => {
    const user = await seedUser();
    const app = fixture();
    const first = await login(app, { email: user.email, password }, '192.0.2.1', { Cookie: 'session=client-chosen-value' });
    const firstToken = credential(first);
    const second = await login(app, { email: user.email, password }, '192.0.2.1', { Cookie: `session=${firstToken}` });
    expect(second.status).toBe(200);
    expect(credential(second)).not.toBe(firstToken);
    expect(firstToken).not.toBe('client-chosen-value');
    expect(await database.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(2);
  });

  test('returns the same safe failure for a wrong password and unknown email, verifying both', async () => {
    const user = await seedUser();
    const verify = spyOn(Bun.password, 'verify');
    try {
      const app = fixture();
      const wrong = await login(app, { email: user.email, password: password.trim() });
      const missing = await login(app, { email: email(), password });
      for (const response of [wrong, missing]) {
        expect(response.status).toBe(401);
        expect(response.headers.has('Set-Cookie')).toBe(false);
        expect(await response.json()).toMatchObject({ error: {
          status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.',
        } });
      }
      expect(verify).toHaveBeenCalledTimes(2);
      expect(verify.mock.calls[1]?.[1]).toStartWith('$argon2id$v=19$m=19456,t=2,p=1$');
      expect(await database.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
    } finally { verify.mockRestore(); }
  });

  test.each([
    {}, { email: 'invalid', password }, { email: 'learner@example.test', password: '' },
    { email: 'learner@example.test', password: '🐢'.repeat(129) },
    { email: 'learner@example.test', password, sessionId: 'client-chosen-value' },
  ])('rejects invalid or extra login fields before password verification', async (body) => {
    const verify = spyOn(Bun.password, 'verify');
    try {
      const response = await login(fixture(), body);
      expect(response.status).toBe(400);
      expect(response.headers.has('Set-Cookie')).toBe(false);
      expect(verify).not.toHaveBeenCalled();
    } finally { verify.mockRestore(); }
  });

  test('rechecks the password hash before creating the session', async () => {
    const user = await seedUser();
    const changedHash = await Bun.password.hash('a replacement passphrase', { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 });
    const realVerify = Bun.password.verify.bind(Bun.password);
    const verify = spyOn(Bun.password, 'verify').mockImplementationOnce(async (value, hash) => {
      const valid = await realVerify(value, hash);
      await database.update(users).set({ passwordHash: changedHash }).where(eq(users.id, user.id));
      return valid;
    });
    try {
      const response = await login(fixture(), { email: user.email, password });
      expect(response.status).toBe(401);
      expect(response.headers.has('Set-Cookie')).toBe(false);
      expect(await database.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id))).toHaveLength(0);
    } finally { verify.mockRestore(); }
  });

  test('does not issue a cookie when the session transaction fails', async () => {
    const user = await seedUser();
    const transaction = spyOn(database, 'transaction').mockRejectedValue(new Error('synthetic-session-store-secret'));
    try {
      const response = await login(fixture(), { email: user.email, password });
      expect(response.status).toBe(500);
      expect(response.headers.has('Set-Cookie')).toBe(false);
      expect(await response.text()).not.toContain('synthetic-session-store-secret');
      expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-session-store-secret');
    } finally { transaction.mockRestore(); }
  });
});

describe('login limits', () => {
  test('counts successful logins without clearing earlier attempts for that email', async () => {
    const user = await seedUser();
    const app = fixture();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await login(app, { email: user.email, password: 'incorrect' })).status).toBe(401);
    }
    expect((await login(app, { email: user.email, password })).status).toBe(200);
    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await login(app, { email: user.email, password: 'incorrect' })).status).toBe(401);
    }
    const response = await login(app, { email: user.email, password });
    expect(response.status).toBe(429);
    expect(response.headers.has('Set-Cookie')).toBe(false);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  test('limits attempts by normalized email across peer addresses and resets after fifteen minutes', async () => {
    const app = fixture();
    const address = email();
    const clock = spyOn(Date, 'now').mockReturnValue(1000);
    try {
      for (let index = 0; index < 10; index++) {
        expect((await login(app, { email: index % 2 ? address.toUpperCase() : address, password }, `192.0.2.${index + 1}`)).status).toBe(401);
      }
      const response = await login(app, { email: address, password }, '192.0.2.20');
      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('900');
      clock.mockReturnValue(901_000);
      expect((await login(app, { email: address, password })).status).toBe(401);
    } finally { clock.mockRestore(); }
  });

  test('limits all attempts by peer and ignores forwarded IP headers', async () => {
    const app = fixture();
    for (let index = 0; index < 30; index++) {
      expect((await login(app, {}, '192.0.2.1', { 'X-Forwarded-For': `198.51.100.${index}` })).status).toBe(400);
    }
    const response = await login(app, {});
    expect(response.status).toBe(429);
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await login(app, {}, '192.0.2.2')).status).toBe(400);
  });

  test('bounds peer and email maps and reclaims expired capacity', async () => {
    const app = fixture();
    const clock = spyOn(Date, 'now').mockReturnValue(1000);
    const verify = spyOn(Bun.password, 'verify').mockResolvedValue(false);
    try {
      for (let index = 0; index < 1024; index++) {
        expect((await login(app, {}, `198.18.${Math.floor(index / 256)}.${index % 256}`)).status).toBe(400);
      }
      expect((await login(app, {}, '192.0.2.99')).status).toBe(429);
      clock.mockReturnValue(901_000);
      for (let index = 0; index < 1024; index++) {
        expect((await login(app, { email: email(), password }, `192.0.2.${Math.floor(index / 30) + 1}`)).status).toBe(401);
      }
      expect((await login(app, { email: email(), password }, '192.0.2.99')).status).toBe(429);
      clock.mockReturnValue(1_801_000);
      expect((await login(app, { email: email(), password }, '192.0.2.99')).status).toBe(401);
    } finally { verify.mockRestore(); clock.mockRestore(); }
  }, 10000);

  test('shares password capacity with registration and releases it after verification errors', async () => {
    const app = fixture();
    const rejects: Array<(reason: Error) => void> = [];
    const verify = spyOn(Bun.password, 'verify').mockImplementation(() => new Promise<boolean>((_resolve, reject) => { rejects.push(reject); }));
    const pending = [login(app, { email: email(), password }), login(app, { email: email(), password }, '192.0.2.2')];
    try {
      for (let attempt = 0; rejects.length < 2 && attempt < 100; attempt++) await Bun.sleep(1);
      expect(verify).toHaveBeenCalledTimes(2);
      const blocked = await register(app, { email: email(), password }, '192.0.2.3');
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('Retry-After')).toBe('1');
      rejects.splice(0).forEach((reject) => reject(new Error('synthetic-private-verification-failure')));
      for (const response of await Promise.all(pending)) {
        expect(response.status).toBe(500);
        expect(await response.text()).not.toContain('synthetic-private-verification-failure');
      }
      verify.mockRestore();
      expect((await login(app, { email: email(), password }, '192.0.2.4')).status).toBe(401);
    } finally {
      rejects.forEach((reject) => reject(new Error('Test cleanup.')));
      await Promise.all(pending);
      verify.mockRestore();
    }
  });
});
