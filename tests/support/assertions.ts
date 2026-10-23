import { expect } from 'bun:test';

export async function expectDatabaseError(operation: PromiseLike<unknown>, code: string) {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  expect((failure as { code?: string } | undefined)?.code).toBe(code);
}
