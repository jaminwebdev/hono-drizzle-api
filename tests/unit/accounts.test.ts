import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { accountListSchema } from '../../src/features/accounts';

describe('account list query', () => {
  test('supplies pagination defaults and parses only explicit booleans', () => {
    expect(v.parse(accountListSchema, {})).toEqual({
      q: '',
      page: 1,
      limit: 25,
    });
    expect(
      v.parse(accountListSchema, {
        q: '  Checking  ',
        archived: 'false',
        page: '2',
        limit: '100',
      }),
    ).toEqual({ q: 'Checking', archived: false, page: 2, limit: 100 });
    expect(v.parse(accountListSchema, { archived: 'true' }).archived).toBe(
      true,
    );
  });

  test('permits exactly the maximum offset and a 100-character search', () => {
    expect(v.parse(accountListSchema, { page: '101', limit: '100' }).page).toBe(
      101,
    );
    expect(v.parse(accountListSchema, { page: '10001', limit: '1' }).page).toBe(
      10001,
    );
    expect(
      v.parse(accountListSchema, { q: ` ${'a'.repeat(100)} ` }).q,
    ).toHaveLength(100);
  });

  test.each<unknown>([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { page: '1e2' },
    { page: '01' },
    { page: '1\n' },
    { page: ' 1' },
    { page: '999999999999999999999' },
    { page: '' },
    { limit: '0' },
    { limit: '101' },
    { limit: '1.0' },
    { limit: '01' },
    { limit: '1e2' },
    { page: '102', limit: '100' },
    { page: '10002', limit: '1' },
    { q: 'a'.repeat(101) },
    { archived: '1' },
    { archived: 'FALSE' },
    { archived: '' },
    { archived: 'true ' },
    { page: ['1', '2'] },
    { limit: ['25', '25'] },
    { q: ['cash', 'savings'] },
    { archived: ['true', 'false'] },
    { userId: crypto.randomUUID() },
    { tagId: crypto.randomUUID() },
    { sort: 'name' },
  ])('rejects invalid, duplicate, or unsupported query values: %j', (query) => {
    expect(v.safeParse(accountListSchema, query).success).toBe(false);
  });
});
