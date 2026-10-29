import * as v from 'valibot';

const portSchema = v.pipe(
  v.string(),
  v.regex(/^[1-9]\d{0,4}$/),
  v.transform(Number),
  v.minValue(1),
  v.maxValue(65535),
);
const requiredString = v.pipe(v.string(), v.regex(/\S/));

const configSchema = v.object({
  APP_ENV: v.picklist(['local', 'test', 'production']),
  API_PORT: portSchema,
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

  return result.output;
}
