import { createDatabase } from './client.js';
import { loadConfig } from '../lib/config.js';
import { requireLocalSeed, seedDemo } from './seed-demo.js';

try {
  requireLocalSeed(process.env.APP_ENV);
  const config = loadConfig('local');
  const database = createDatabase(config.database);
  try {
    const result = await seedDemo(database.db, config.environment);
    console.info(result === 'created' ? 'Demo data created for January and February 2026.' : 'Demo data already exists. No rows were changed.');
  } finally {
    await database.close();
  }
} catch (error) {
  // Driver errors can include private database values. Print only our controlled messages.
  const message = error instanceof Error && (error.message.startsWith('Demo ') || error.message.startsWith('Invalid configuration'))
    ? error.message : 'Demo seed failed. No seed rows were committed. Check database availability, push the schema, and inspect fixture conflicts in Studio.';
  console.error(message);
  process.exitCode = 1;
}
