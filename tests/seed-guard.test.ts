import { describe, expect, it } from 'bun:test';
import { requireLocalSeed } from '../src/db/seed-demo.js';

describe('demo seed environment guard', () => {
  it('allows an explicitly selected local environment', () => {
    expect(() => requireLocalSeed('local')).not.toThrow();
  });

  it('rejects production and missing settings', () => {
    expect(() => requireLocalSeed('production')).toThrow('only with APP_ENV=local');
    expect(() => requireLocalSeed(undefined)).toThrow('only with APP_ENV=local');
  });
});
