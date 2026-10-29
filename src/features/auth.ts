import { SQL } from 'bun';
import { DrizzleQueryError } from 'drizzle-orm';
import { Hono } from 'hono';
import { getConnInfo } from 'hono/bun';
import * as v from 'valibot';
import type { Database } from '../db/client';
import { users } from '../db/schema';
import { ApiError, errorResponse, readJson, type HttpEnv } from '../http';

const commonPasswords = new Set([
  'passwordpassword', 'password123456789', '123456789012345',
  'qwertyuiopasdfgh', 'letmeinletmeinletmein',
]);

export const registrationSchema = v.strictObject({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.maxLength(254), v.email()),
  password: v.pipe(
    v.string(), v.minCodePoints(15), v.maxCodePoints(128),
    v.check((value) => !commonPasswords.has(value.toLowerCase())),
  ),
});

export function createAuthRoutes(database: Database) {
  const auth = new Hono<HttpEnv>();
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  let activeHashes = 0;

  auth.post('/register', async (c) => {
    const peer = getConnInfo(c).remote.address;
    if (!peer) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Connection information is unavailable.');

    const now = Date.now();
    for (const [address, entry] of attempts) {
      if (entry.expiresAt <= now) attempts.delete(address);
    }
    const entry = attempts.get(peer);
    if (entry && entry.count >= 5) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((entry.expiresAt - now) / 1000))));
      return errorResponse(c, 429, 'RATE_LIMITED', 'Too many registration attempts.');
    }
    if (!entry && attempts.size >= 1024) {
      c.header('Retry-After', '60');
      return errorResponse(c, 429, 'RATE_LIMITED', 'Registration capacity is temporarily full.');
    }
    attempts.set(peer, { count: (entry?.count ?? 0) + 1, expiresAt: entry?.expiresAt ?? now + 3_600_000 });

    const result = v.safeParse(registrationSchema, await readJson(c));
    if (!result.success) {
      throw new ApiError(400, 'INVALID_INPUT', 'Provide only a valid email and a password of 15–128 characters that is not commonly used.');
    }
    if (activeHashes >= 2) {
      c.header('Retry-After', '1');
      return errorResponse(c, 429, 'RATE_LIMITED', 'Password processing is temporarily full.');
    }

    activeHashes++;
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
      activeHashes--;
    }
  });

  return auth;
}
