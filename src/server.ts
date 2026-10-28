import app from './app';
import { readConfig } from './config';

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid application configuration.');
  process.exit(1);
}

const server = Bun.serve({
  hostname: config.APP_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
  port: config.API_PORT,
  fetch: app.fetch,
});

console.log(`API listening at ${server.url}`);
