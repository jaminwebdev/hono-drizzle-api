import { SQL } from 'bun';
import { DrizzleQueryError, eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { setCookie } from 'hono/cookie';
import * as v from 'valibot';
import type { Config } from '../config';
import type { Database } from '../db/client';
import { sessions, users } from '../db/schema';
import { ApiError, readJson, type HttpEnv } from '../http';

const commonPasswords = new Set([
  'passwordpassword', 'password123456789', '123456789012345',
  'qwertyuiopasdfgh', 'letmeinletmeinletmein',
]);

const emailSchema = v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(254), v.email());
export const registrationSchema = v.strictObject({
  email: emailSchema,
  password: v.pipe(
    v.string(), v.minCodePoints(15), v.maxCodePoints(128),
    v.check((value) => !commonPasswords.has(value.toLowerCase())),
  ),
});

const loginSchema = v.strictObject({
  email: emailSchema,
  password: v.pipe(v.string(), v.minCodePoints(1), v.maxCodePoints(128)),
});
// A public dummy hash gives unknown emails the same password-verification work.
const dummyPasswordHash = '$argon2id$v=19$m=19456,t=2,p=1$UwQppmCDH/HgwJS57oHKVWLOdOdo3ws2tT5xFgzYWD0$LUX6occDbacP2KJ8bMqFDUxIdFBxf2+6Sw/q3o5ZoYs';
const sessionMaxAge = 604800;
type AttemptWindow = { count: number; expiresAt: number };

function createAttemptLimit(maxAttempts: number, windowMs: number) {
  const attempts = new Map<string, AttemptWindow>();
  return (c: Context<HttpEnv>, key: string) => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (entry.expiresAt <= now) attempts.delete(key);
    }
    const entry = attempts.get(key);
    if (entry && entry.count >= maxAttempts) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((entry.expiresAt - now) / 1000))));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many authentication attempts.');
    }
    if (!entry && attempts.size >= 1024) {
      c.header('Retry-After', '60');
      throw new ApiError(429, 'RATE_LIMITED', 'Authentication capacity is temporarily full.');
    }
    attempts.set(key, { count: (entry?.count ?? 0) + 1, expiresAt: entry?.expiresAt ?? now + windowMs });
  };
}

export function createAuthRoutes(database: Database, mode: Config['APP_ENV']) {
  const auth = new Hono<HttpEnv>();
  const limitRegistrationIp = createAttemptLimit(5, 3_600_000);
  const limitLoginIp = createAttemptLimit(30, 900_000);
  const limitLoginEmail = createAttemptLimit(10, 900_000);
  let activePasswordWork = 0;

  auth.post('/register', async (c) => {
    const peer = getConnInfo(c).remote.address;
    if (!peer) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Connection information is unavailable.');

    limitRegistrationIp(c, peer);

    const result = v.safeParse(registrationSchema, await readJson(c));
    if (!result.success) {
      throw new ApiError(400, 'INVALID_INPUT', 'Provide only a valid email and a password of 15–128 characters that is not commonly used.');
    }
    if (activePasswordWork >= 2) {
      c.header('Retry-After', '1');
      throw new ApiError(429, 'RATE_LIMITED', 'Password processing is temporarily full.');
    }

    activePasswordWork++;
    try {
      const passwordHash = await Bun.password.hash(result.output.password, {
        algorithm: 'argon2id', memoryCost: 19456, timeCost: 2,
      });
      const [user] = await database.insert(users)
        .values({ email: result.output.email, passwordHash })
        .returning({ id: users.id, email: users.email });
      if (!user) throw new Error('Registration returned no user.');
      return c.json({ data: user }, 201);
    } catch (error) {
      const cause = error instanceof DrizzleQueryError ? error.cause : error;
      if (cause instanceof SQL.PostgresError && cause.errno === '23505'
        && cause.constraint === 'users_email_unique') {
        throw new ApiError(409, 'ACCOUNT_NOT_AVAILABLE', 'That account is unavailable.');
      }
      throw error;
    } finally {
      activePasswordWork--;
    }
  });

  auth.post('/login', async (c) => {
    const peer = getConnInfo(c).remote.address;
    if (!peer) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Connection information is unavailable.');

    limitLoginIp(c, peer);

    const result = v.safeParse(loginSchema, await readJson(c));
    if (!result.success) throw new ApiError(400, 'INVALID_INPUT', 'Provide only a valid email and a nonempty password of at most 128 characters.');
    const { email, password } = result.output;
    limitLoginEmail(c, email);
    if (activePasswordWork >= 2) {
      c.header('Retry-After', '1');
      throw new ApiError(429, 'RATE_LIMITED', 'Password processing is temporarily full.');
    }

    activePasswordWork++;
    try {
      const [user] = await database.select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
        .from(users).where(eq(users.email, email)).limit(1);
      const valid = await Bun.password.verify(password, user?.passwordHash ?? dummyPasswordHash);
      if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

      const credential = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
      const tokenHash = new Bun.CryptoHasher('sha256').update(credential).digest('hex');
      const identity = await database.transaction(async (tx) => {
        const [current] = await tx.select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
          .from(users).where(eq(users.id, user.id)).for('update');
        if (!current || current.passwordHash !== user.passwordHash) {
          throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
        }
        await tx.insert(sessions).values({
          userId: current.id, tokenHash, expiresAt: new Date(Date.now() + sessionMaxAge * 1000),
        });
        return { id: current.id, email: current.email };
      });

      setCookie(c, 'session', credential, {
        httpOnly: true, sameSite: 'Lax', path: '/', maxAge: sessionMaxAge, secure: mode === 'production',
      });
      return c.json({ data: identity });
    } finally {
      activePasswordWork--;
    }
  });

  return auth;
}
