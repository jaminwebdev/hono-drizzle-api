import { Hono } from 'hono';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { categories } from '../db/schema.js';
import { ApiError, type AppEnv } from '../lib/http.js';
import { readJson, validate } from '../lib/validation.js';

const nameSchema = z.string().trim().min(1).max(100).regex(/^\P{Cc}*$/u);
const createInput = z.strictObject({
  name: nameSchema,
});
const patchInput = z.strictObject({
  name: nameSchema.optional(),
  archived: z.boolean().optional(),
}).refine((input) => Object.keys(input).length > 0);

const pageNumber = z.string().regex(/^[1-9]\d*$/).transform(Number)
  .pipe(z.number().int().max(Number.MAX_SAFE_INTEGER));
const listInput = z.strictObject({
  page: pageNumber.default(1),
  limit: pageNumber.pipe(z.number().max(100)).default(25),
  sort: z.enum(['name', 'createdAt', 'updatedAt']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  includeArchived: z.enum(['true', 'false']).default('false'),
});

const fields = {
  id: categories.id,
  name: categories.name,
  archivedAt: categories.archivedAt,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
};

export function categoryRoutes(db: NodePgDatabase) {
  const routes = new Hono<AppEnv>();

  routes.get('/', async (c) => {
    const ownerId = c.get('ownerId');
    for (const values of Object.values(c.req.queries())) {
      if (values.length !== 1) throw new ApiError(422, 'VALIDATION_ERROR', 'Query fields cannot be repeated.');
    }
    const query = validate(listInput, c.req.query());
    const { page, limit, sort, direction } = query;
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(offset + limit + 1)) {
      throw new ApiError(422, 'VALIDATION_ERROR', 'Pagination exceeds the supported range.');
    }

    const order = direction === 'asc' ? asc : desc;
    const column = sort === 'name' ? sql`lower(${categories.name})` : categories[sort];
    const rows = await db.select(fields)
      .from(categories)
      .where(and(
        eq(categories.ownerId, ownerId),
        query.includeArchived === 'true' ? undefined : isNull(categories.archivedAt),
      ))
      .orderBy(order(column), order(categories.id))
      .limit(limit + 1)
      .offset(offset);

    return c.json({
      data: rows.slice(0, limit),
      pagination: { page, limit, hasMore: rows.length > limit },
    });
  });

  routes.post('/', async (c) => {
    const ownerId = c.get('ownerId');
    const input = await readJson(c, createInput);
    const [row] = await db.insert(categories)
      .values({ ...input, ownerId })
      .returning(fields);
    if (!row) throw new Error('Insert did not return a row.');

    c.header('Location', `/api/v1/categories/${row.id}`);
    return c.json({ data: row }, 201);
  });

  routes.get('/:id', async (c) => {
    const ownerId = c.get('ownerId');
    const id = validate(z.uuid(), c.req.param('id'));
    const [row] = await db.select(fields)
      .from(categories)
      .where(and(eq(categories.ownerId, ownerId), eq(categories.id, id)))
      .limit(1);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Category not found.');

    return c.json({ data: row });
  });

  routes.patch('/:id', async (c) => {
    const ownerId = c.get('ownerId');
    const id = validate(z.uuid(), c.req.param('id'));
    const input = await readJson(c, patchInput);
    let archivedAt: SQL | null | undefined;
    if (input.archived === true) archivedAt = sql`coalesce(${categories.archivedAt}, now())`;
    if (input.archived === false) archivedAt = null;

    // Drizzle leaves fields unchanged when their update value is undefined.
    const [row] = await db.update(categories)
      .set({
        name: input.name,
        archivedAt,
        updatedAt: sql`now()`,
      })
      .where(and(eq(categories.ownerId, ownerId), eq(categories.id, id)))
      .returning(fields);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Category not found.');

    return c.json({ data: row });
  });

  return routes;
}
