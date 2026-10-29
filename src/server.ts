import { createApp } from './app';
import { readConfig } from './config';
import { createDatabase } from './db/client';

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid application configuration.');
  process.exit(1);
}

let database;
try {
  database = createDatabase(config);
  await database.$client.connect();
} catch {
  console.error('Unable to connect to PostgreSQL. Check its settings and whether it is running.');
  await database?.$client.close({ timeout: 0 });
  process.exit(1);
}

const pool = database.$client;
const app = createApp(database);
const server = Bun.serve({
  hostname: config.APP_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
  port: config.API_PORT,
  fetch: app.fetch,
});

let stopping = false;

async function shutdown(exitCode: number) {
  if (exitCode !== 0) process.exitCode = exitCode;
  if (stopping) return;
  stopping = true;
  process.exitCode ??= exitCode;
  console.log('Stopping the API.');

  const deadline = setTimeout(() => {
    void server.stop(true);
    void pool.close({ timeout: 0 });
    process.exit(1);
  }, 5000);

  try {
    await server.stop();
    await pool.close({ timeout: 1 });
    clearTimeout(deadline);
  } catch {
    console.error('Unable to finish API shutdown.');
    process.exit(1);
  }
}

process.on('SIGINT', () => { void shutdown(0); });
process.on('SIGTERM', () => { void shutdown(0); });

function handleFatalError() {
  console.error('Fatal application error; stopping the API.');
  void shutdown(1);
}

process.on('uncaughtException', handleFatalError);
process.on('unhandledRejection', handleFatalError);

console.log(`API listening at ${server.url}`);
