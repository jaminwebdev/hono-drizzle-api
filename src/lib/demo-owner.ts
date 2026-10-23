import { createMiddleware } from 'hono/factory';
import { DEMO_OWNER_ID } from './demo-identity.js';
import { ApiError, type AppEnv } from './http.js';

export type FindOwner = (id: string) => Promise<boolean>;

export function demoOwner(findOwner: FindOwner) {
  return createMiddleware<AppEnv>(async (c, next) => {
    // Headers and query parameters never select the owner. Mutation schemas reject owner fields.
    let exists: boolean;
    try { exists = await findOwner(DEMO_OWNER_ID); } catch {
      throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Database is unavailable.');
    }
    if (!exists) throw new ApiError(503, 'DEMO_OWNER_MISSING', 'Demo owner is missing. Run bun run db:seed locally.');
    c.set('ownerId', DEMO_OWNER_ID);
    await next();
  });
}
