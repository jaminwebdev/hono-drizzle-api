import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

const environmentSchema = z.enum(['local', 'production']);
const sourceSchema = z.enum(['file', 'environment']);

const portSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65535));

const credentialSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0 && !value.includes('\0'));

const settingsSchema = z.object({
  APP_ENV: environmentSchema,
  API_PORT: portSchema.default(3000),
  POSTGRES_PORT: portSchema.default(5433),
  POSTGRES_USER: credentialSchema,
  POSTGRES_PASSWORD: credentialSchema,
  POSTGRES_DB: credentialSchema,
});

interface ConfigOptions {
  environment: unknown;
  source: unknown;
  directory?: string;
  values?: NodeJS.ProcessEnv;
}

export function loadConfig({
  environment,
  source,
  directory = process.cwd(),
  values = process.env,
}: ConfigOptions) {
  const selectedEnvironment = environmentSchema.safeParse(environment);
  const selectedSource = sourceSchema.safeParse(source);

  if (!selectedEnvironment.success || !selectedSource.success) {
    throw new Error(
      'Select local or production and a configuration source: file or environment.',
    );
  }

  let input: NodeJS.ProcessEnv;

  if (selectedSource.data === 'file') {
    const filename = `.env.${selectedEnvironment.data}`;

    try {
      input = parseEnv(readFileSync(join(directory, filename), 'utf8'));
    } catch {
      throw new Error(`Unable to read ${filename}. Create it before starting the API.`);
    }
  } else {
    input = values;
  }

  const parsed = settingsSchema.safeParse(input);

  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`Invalid configuration fields: ${fields.join(', ')}.`);
  }

  const settings = parsed.data;

  if (settings.APP_ENV !== selectedEnvironment.data) {
    throw new Error('APP_ENV must match the selected local or production environment.');
  }

  return {
    environment: selectedEnvironment.data,
    apiPort: settings.API_PORT,
    databaseHostPort: settings.POSTGRES_PORT,
    database: {
      host: 'db',
      port: 5432,
      user: settings.POSTGRES_USER,
      password: settings.POSTGRES_PASSWORD,
      database: settings.POSTGRES_DB,
    },
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
