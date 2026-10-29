import * as v from 'valibot';

const portSchema = v.pipe(
  v.string(),
  v.regex(/^[1-9]\d{0,4}$/),
  v.transform(Number),
  v.minValue(1),
  v.maxValue(65535),
);
const requiredString = v.pipe(v.string(), v.regex(/\S/));
const originSchema = v.pipe(v.string(), v.check((value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}));

const configSchema = v.object({
  APP_ENV: v.picklist(['local', 'test', 'production']),
  API_PORT: portSchema,
  API_ORIGIN: originSchema,
  CORS_ORIGINS: v.optional(v.pipe(
    v.string(),
    v.transform((value) => value.trim() === '' ? [] : value.split(',').map((origin) => origin.trim())),
    v.array(originSchema),
  ), ''),
  POSTGRES_HOST: requiredString,
  POSTGRES_PORT: portSchema,
  POSTGRES_USER: requiredString,
  POSTGRES_DB: requiredString,
  POSTGRES_PASSWORD: requiredString,
});

export function readConfig(source: Record<string, unknown>) {
  const result = v.safeParse(configSchema, source);
  if (!result.success) {
    const fields = result.issues.flatMap((issue) => {
      const key = issue.path?.[0]?.key;
      return typeof key === 'string' ? [key] : [];
    });
    throw new Error(`Invalid configuration fields: ${[...new Set(fields)].join(', ')}.`);
  }

  if (result.output.APP_ENV === 'production' && !result.output.API_ORIGIN.startsWith('https://')) {
    throw new Error('API_ORIGIN must use HTTPS in production.');
  }
  return result.output;
}

export type Config = v.InferOutput<typeof configSchema>;
