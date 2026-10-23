import { defineConfig } from 'drizzle-kit';
import { loadConfig } from './src/lib/config.js';

// Bun supplies the selected environment; validation does not read files.
const config = loadConfig(process.env.APP_ENV);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  schemaFilter: ['public'],
  dbCredentials: {
    ...config.database,
    // The bundled Compose database does not configure SSL.
    ssl: false,
  },
  strict: true,
  verbose: false,
});
