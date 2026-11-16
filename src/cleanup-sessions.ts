import { and, inArray, lte, or } from 'drizzle-orm';
import { readConfig } from './config';
import { createDatabase, type Database } from './db/client';
import { sessions } from './db/schema';

export function readCleanupConfig(source: Record<string, unknown>) {
  const config = readConfig(source);
  const mode = source.DATABASE_TASK_MODE;
  const target =
    mode === 'local'
      ? { port: 5433, database: 'finance_tracker_local' }
      : mode === 'test'
        ? { port: 5435, database: 'finance_tracker_test' }
        : mode === 'production'
          ? { port: 5434, database: 'finance_tracker_production' }
          : undefined;

  if (
    !target ||
    config.APP_ENV !== mode ||
    config.POSTGRES_HOST !== '127.0.0.1' ||
    config.POSTGRES_PORT !== target.port ||
    config.POSTGRES_DB !== target.database
  ) {
    throw new Error(
      'Session cleanup requires the matching database task settings.',
    );
  }
  return config;
}

export async function cleanupExpiredSessions(
  database: Database,
  now = new Date(Date.now()),
) {
  const expired = or(
    lte(sessions.expiresAt, now),
    lte(sessions.lastSeenAt, new Date(now.getTime() - 30 * 60 * 1000)),
  );
  const candidates = database
    .select({ id: sessions.id })
    .from(sessions)
    .where(expired)
    .limit(100);

  // Recheck expiry on the delete after any concurrent activity update releases its lock.
  const deleted = await database
    .delete(sessions)
    .where(and(inArray(sessions.id, candidates), expired))
    .returning({ id: sessions.id });
  return deleted.length;
}

if (import.meta.main) {
  let database: Database | undefined;
  try {
    const config = readCleanupConfig(process.env);
    database = createDatabase(config);
    const count = await cleanupExpiredSessions(database);
    console.log(
      `Deleted ${count} expired sessions. Each run removes at most 100 rows; repeat for another batch.`,
    );
  } catch {
    console.error(
      'Session cleanup failed. Check the selected database settings and PostgreSQL availability.',
    );
    process.exitCode = 1;
  } finally {
    try {
      await database?.$client.close({ timeout: 1 });
    } catch {
      console.error('Unable to close the session cleanup database connection.');
      process.exitCode = 1;
    }
  }
}
