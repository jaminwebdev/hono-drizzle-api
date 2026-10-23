import { Client } from 'pg';
import {
  requireTestDatabaseName, testDatabaseOptions, verifyTestDatabase,
} from '../tests/support/database.js';

async function run() {
  const options = testDatabaseOptions();
  const admin = new Client(options);
  const name = requireTestDatabaseName(`finance_test_${crypto.randomUUID().replaceAll('-', '')}`);
  let created = false;

  try {
    await admin.connect();
    await verifyTestDatabase(admin, options.database);
    // The name is generated here and validated before use as a SQL identifier.
    await admin.query(`create database "${name}"`);
    created = true;
    const environment = { ...process.env, TEST_DATABASE_NAME: name };

    const push = Bun.spawn([
      process.execPath, '--bun', 'run', 'drizzle-kit', 'push',
      '--config=tests/integration/drizzle.config.ts',
    ], { env: environment, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
    const pushStatus = await push.exited;
    if (pushStatus !== 0) return pushStatus;

    const tests = Bun.spawn([process.execPath, 'test', './tests/integration'], {
      env: environment, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
    });
    return await tests.exited;
  } finally {
    try {
      if (created) {
        await verifyTestDatabase(admin, options.database);
        requireTestDatabaseName(name);
        await admin.query(`drop database "${name}" with (force)`);
        console.info('Removed the database created for this test run.');
      }
    } finally {
      await admin.end();
    }
  }
}

try {
  process.exitCode = await run();
} catch {
  console.error('Integration database setup, checks, or cleanup failed.');
  process.exitCode = 1;
}
