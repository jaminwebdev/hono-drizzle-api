import { Client } from 'pg';
import {
  requireTestDatabaseName, testDatabaseOptions, verifyTestDatabase,
} from '../tests/support/database.js';

const interruption = new AbortController();
const stop = () => { interruption.abort(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

async function run() {
  const id = crypto.randomUUID().replaceAll('-', '');
  const project = `hono-drizzle-test-${id}`;
  const compose = ['docker', 'compose', '-p', project, '-f', 'compose.test.yaml'];
  const name = requireTestDatabaseName(`finance_test_${id}`);
  let admin: Client | undefined;
  let created = false;
  console.info(`Temporary database project: ${project}`);

  try {
    const start = Bun.spawn([...compose, 'up', '--detach', '--wait', '--wait-timeout', '120', 'db'], {
      signal: interruption.signal, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
    });
    const startStatus = await start.exited;
    if (startStatus !== 0) return startStatus;

    const mapping = Bun.spawn([...compose, 'port', 'db', '5432'], {
      signal: interruption.signal, stdout: 'pipe', stderr: 'inherit',
    });
    const address = (await new Response(mapping.stdout).text()).trim();
    if (await mapping.exited !== 0) throw new Error('Could not read the test database port.');
    const binding = /^127\.0\.0\.1:(\d+)$/.exec(address);
    if (!binding) throw new Error('The test database must publish only on loopback.');
    const environment = {
      ...process.env,
      RUN_DATABASE_TESTS: '1', TEST_DATABASE_HOST: '127.0.0.1', TEST_DATABASE_PORT: binding[1],
      TEST_DATABASE_USER: 'finance_test', TEST_DATABASE_PASSWORD: 'finance_test', TEST_DATABASE_NAME: name,
    };
    const options = testDatabaseOptions(environment);
    admin = new Client(options);
    await admin.connect();
    await verifyTestDatabase(admin, options.database);
    await admin.query(`create database "${name}"`);
    created = true;

    const push = Bun.spawn([
      process.execPath, '--bun', 'run', 'drizzle-kit', 'push',
      '--config=tests/integration/drizzle.config.ts',
    ], { signal: interruption.signal, env: environment, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' });
    const pushStatus = await push.exited;
    if (pushStatus !== 0) return pushStatus;

    const tests = Bun.spawn([process.execPath, 'test', './tests/integration'], {
      signal: interruption.signal, env: environment, stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
    });
    return await tests.exited;
  } finally {
    try {
      try {
        if (created && admin) {
          await verifyTestDatabase(admin, 'finance_test');
          requireTestDatabaseName(name);
          await admin.query(`drop database "${name}" with (force)`);
          console.info('Removed the database created for this test run.');
        }
      } finally {
        await admin?.end();
      }
    } finally {
      const cleanup = Bun.spawn([...compose, 'down', '--remove-orphans'], {
        stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
      });
      if (await cleanup.exited !== 0) {
        console.error(`Remove the temporary project ${project} manually.`);
        process.exitCode = 1;
      }
    }
  }
}

try {
  const status = await run();
  if (status !== 0) process.exitCode = status;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Integration checks failed.');
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
