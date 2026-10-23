import { Hono } from 'hono';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AppEnv } from './lib/http.js';
import { accountRoutes } from './modules/accounts.js';
import { categoryRoutes } from './modules/categories.js';

export function createApi(db: NodePgDatabase) {
  const api = new Hono<AppEnv>();
  api.route('/accounts', accountRoutes(db));
  api.route('/categories', categoryRoutes(db));
  return api;
}
