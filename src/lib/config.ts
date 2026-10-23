import { z } from 'zod';

const environmentSchema = z.enum(['local', 'production']);

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

export function loadConfig(environment: unknown, values: NodeJS.ProcessEnv = process.env) {
  const selectedEnvironment = environmentSchema.safeParse(environment);

  if (!selectedEnvironment.success) {
    throw new Error('Select local or production when starting the API.');
  }

  const parsed = settingsSchema.safeParse(values);

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
