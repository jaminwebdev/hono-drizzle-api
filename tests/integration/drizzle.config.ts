import { defineConfig } from 'drizzle-kit';
import { requireTestDatabaseName, testDatabaseOptions } from '../support/database.js';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  schemaFilter: ['public'],
  dbCredentials: {
    ...testDatabaseOptions(),
    database: requireTestDatabaseName(process.env.TEST_DATABASE_NAME),
  },
  // Only the runner's newly created, isolated database uses noninteractive push.
  strict: false,
  verbose: false,
});
