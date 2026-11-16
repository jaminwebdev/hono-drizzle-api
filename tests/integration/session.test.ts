import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../../src/app';
import { sessions, users } from '../../src/db/schema';
import { createTestDatabase } from './setup';

const database = createTestDatabase();
const ownedUsers: string[] = [];
const origin = 'http://127.0.0.1:3002';
let log: ReturnType<typeof spyOn<typeof console, 'log'>>;
const app = (mode: 'test' | 'production' = 'test') => createApp(database, {
  APP_ENV: mode, API_ORIGIN: mode === 'production' ? 'https://api.example.test' : origin, CORS_ORIGINS: [],
});
const me = (cookie?: string, mode: 'test' | 'production' = 'test') => app(mode).request('/api/v1/auth/me', {
  headers: cookie === undefined ? {} : { Cookie: `session=${cookie}` },
});

async function seed(lastSeenAt = new Date(), expiresAt = new Date(Date.now() + 604800_000)) {
  const [user] = await database.insert(users).values({
    email: `session-${crypto.randomUUID()}@example.test`, passwordHash: 'unused-test-hash',
  }).returning({ id: users.id, email: users.email });
  ownedUsers.push(user!.id);
  const credential = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const [session] = await database.insert(sessions).values({
    userId: user!.id, tokenHash: new Bun.CryptoHasher('sha256').update(credential).digest('hex'),
    lastSeenAt, expiresAt,
  }).returning();
  return { user: user!, session: session!, credential };
}

beforeEach(() => { log = spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(async () => {
  log.mockRestore();
  if (ownedUsers.length) await database.delete(users).where(inArray(users.id, ownedUsers));
  ownedUsers.length = 0;
});
afterAll(async () => { await database.$client.close(); });

describe('session validation', () => {
  test('returns only the cookie owner and refreshes activity without extending absolute expiry', async () => {
    const first = await seed(new Date(Date.now() - 60_000));
    const second = await seed();
    for (const fixture of [first, second]) {
      const response = await me(fixture.credential);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: fixture.user });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.has('Set-Cookie')).toBe(false);
    }
    const [stored] = await database.select().from(sessions).where(eq(sessions.id, first.session.id));
    expect(stored!.lastSeenAt.getTime()).toBeGreaterThan(first.session.lastSeenAt.getTime());
    expect(stored!.expiresAt).toEqual(first.session.expiresAt);
    const output = JSON.stringify(log.mock.calls);
    for (const secret of [first.credential, first.session.tokenHash, first.user.email]) expect(output).not.toContain(secret);
  });

  test.each([undefined, '', 'malformed', 'a'.repeat(44), 'a'.repeat(43)])('rejects missing, malformed, or unknown credentials and clears the cookie', async (credential) => {
    const response = await me(credential);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  test('does not query the session store for malformed input', async () => {
    const update = spyOn(database, 'update');
    try {
      expect((await me('malformed')).status).toBe(401);
      expect(update).not.toHaveBeenCalled();
    } finally { update.mockRestore(); }
  });

  test.each([
    { idle: 1_799_999, absolute: 1, status: 200 },
    { idle: 1_800_000, absolute: 1, status: 401 },
    { idle: 1_800_001, absolute: 1, status: 401 },
    { idle: 0, absolute: 0, status: 401 },
    { idle: 0, absolute: -1, status: 401 },
  ])('enforces exact idle and absolute boundaries: $idle / $absolute', async ({ idle, absolute, status }) => {
    const now = Date.now();
    const fixture = await seed(new Date(now - idle), new Date(now + absolute));
    const clock = spyOn(Date, 'now').mockReturnValue(now);
    try {
      expect((await me(fixture.credential)).status).toBe(status);
      const [stored] = await database.select().from(sessions).where(eq(sessions.id, fixture.session.id));
      expect(stored!.lastSeenAt.getTime()).toBe(status === 200 ? now : now - idle);
    } finally { clock.mockRestore(); }
  });

  test('rejects a revoked credential without affecting another session', async () => {
    const first = await seed();
    const second = await seed();
    await database.delete(sessions).where(eq(sessions.id, first.session.id));
    expect((await me(first.credential)).status).toBe(401);
    expect((await me(second.credential)).status).toBe(200);
  });

  test('fails closed on store errors without discarding a potentially valid cookie', async () => {
    const fixture = await seed();
    const update = spyOn(database, 'update').mockImplementation(() => { throw new Error('private-store-error'); });
    try {
      const response = await me(fixture.credential);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('private-store-error');
      expect(response.headers.has('Set-Cookie')).toBe(false);
    } finally { update.mockRestore(); }
  });

  test('clears invalid production cookies with matching secure attributes', async () => {
    const response = await me('invalid', 'production');
    const cookie = response.headers.get('Set-Cookie')!;
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0']) expect(cookie).toContain(attribute);
    expect(cookie).not.toContain('Domain=');
  });

  test('accepts a real login cookie and leaves public health routes accessible', async () => {
    const fixture = await seed();
    await database.update(users).set({ passwordHash: await Bun.password.hash('a learning passphrase', {
      algorithm: 'argon2id', memoryCost: 19456, timeCost: 2,
    }) }).where(eq(users.id, fixture.user.id));
    const application = app();
    const login = await application.request('/api/v1/auth/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: fixture.user.email, password: 'a learning passphrase' }),
    }, { requestIP: () => ({ address: '192.0.2.1', family: 'IPv4', port: 12345 }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]!;
    const response = await application.request('/api/v1/auth/me', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: fixture.user });
    expect((await application.request('/health/live')).status).toBe(200);
  });
});

const logout = (credential?: string, originHeader: string | undefined = origin, mode: 'test' | 'production' = 'test') => {
  const headers: Record<string, string> = {};
  if (credential) headers.Cookie = `session=${credential}`;
  if (originHeader !== undefined) headers.Origin = originHeader;
  return app(mode).request('/api/v1/auth/logout', { method: 'POST', headers });
};

describe('logout', () => {
  test.each(['test', 'production'] as const)('revokes only the current session and clears the %s cookie', async (mode) => {
    const current = await seed();
    const otherUser = await seed();
    const otherCredential = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    await database.insert(sessions).values({
      userId: current.user.id,
      tokenHash: new Bun.CryptoHasher('sha256').update(otherCredential).digest('hex'),
      expiresAt: new Date(Date.now() + 604800_000),
    });
    const response = await logout(current.credential, mode === 'production' ? 'https://api.example.test' : origin, mode);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    const cookie = response.headers.get('Set-Cookie')!;
    for (const flag of ['Max-Age=0', 'HttpOnly', 'SameSite=Lax', 'Path=/']) expect(cookie).toContain(flag);
    expect(/; Secure(?:;|$)/.test(cookie)).toBe(mode === 'production');
    expect(cookie).not.toContain('Domain=');
    expect(await database.select().from(sessions).where(eq(sessions.id, current.session.id))).toHaveLength(0);
    expect((await me(current.credential)).status).toBe(401);
    expect((await logout(current.credential)).status).toBe(401);
    expect((await me(otherCredential)).status).toBe(200);
    expect((await me(otherUser.credential)).status).toBe(200);
  });

  test.each(['', 'null', 'http://untrusted.example', origin + '/'])('rejects missing or unapproved origins before accessing the session store: %s', async (value) => {
    const current = await seed();
    const update = spyOn(database, 'update');
    const remove = spyOn(database, 'delete');
    try {
      const headers: Record<string, string> = { Cookie: `session=${current.credential}` };
      if (value) headers.Origin = value;
      const response = await app().request('/api/v1/auth/logout', { method: 'POST', headers });
      expect(response.status).toBe(403);
      expect(response.headers.has('Set-Cookie')).toBe(false);
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    } finally { update.mockRestore(); remove.mockRestore(); }
    expect((await me(current.credential)).status).toBe(200);
  });

  test('requires a valid session even with an allowed Origin', async () => {
    expect((await logout()).status).toBe(401);
    expect((await logout('malformed')).status).toBe(401);
  });

  test('does not report success or clear the cookie if session deletion fails', async () => {
    const current = await seed();
    const remove = spyOn(database, 'delete').mockImplementation(() => { throw new Error('private-deletion-error'); });
    try {
      const response = await logout(current.credential);
      expect(response.status).toBe(500);
      expect(response.headers.has('Set-Cookie')).toBe(false);
      expect(await response.text()).not.toContain('private-deletion-error');
    } finally { remove.mockRestore(); }
    expect((await me(current.credential)).status).toBe(200);
  });
});
