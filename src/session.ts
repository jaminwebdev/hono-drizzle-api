import { and, eq, gt, sql } from 'drizzle-orm';
import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { Config } from './config';
import type { Database } from './db/client';
import { sessions, users } from './db/schema';
import { ApiError, type HttpEnv } from './http';

export type SessionEnv = {
  Variables: HttpEnv['Variables'] & {
    session: { id: string; user: { id: string; email: string } };
  };
};

export function clearSessionCookie(c: Context<SessionEnv>, mode: Config['APP_ENV']) {
  setCookie(c, 'session', '', {
    httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0, secure: mode === 'production',
  });
}

export function requireSession(database: Database, mode: Config['APP_ENV']) {
  return createMiddleware<SessionEnv>(async (c, next) => {
    const credential = getCookie(c, 'session');
    const now = new Date(Date.now());
    let identity: SessionEnv['Variables']['session'] | undefined;

    if (credential && /^[A-Za-z0-9_-]{43}$/.test(credential)) {
      const tokenHash = new Bun.CryptoHasher('sha256').update(credential).digest('hex');
      try {
        // The conditional update checks expiry again after any concurrent row lock.
        const [session] = await database.update(sessions)
          .set({ lastSeenAt: sql`greatest(${sessions.lastSeenAt}, ${now})` })
          .where(and(
            eq(sessions.tokenHash, tokenHash),
            gt(sessions.expiresAt, now),
            gt(sessions.lastSeenAt, new Date(now.getTime() - 30 * 60 * 1000)),
          ))
          .returning({ id: sessions.id, userId: sessions.userId });
        if (session) {
          const [user] = await database.select({ id: users.id, email: users.email })
            .from(users).where(eq(users.id, session.userId)).limit(1);
          if (user) identity = { id: session.id, user };
        }
      } catch {
        throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Session verification is unavailable.');
      }
    }

    if (!identity) {
      clearSessionCookie(c, mode);
      throw new ApiError(401, 'UNAUTHENTICATED', 'A valid session is required.');
    }
    c.set('session', identity);
    await next();
  });
}
