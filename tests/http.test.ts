import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { z } from 'zod';
import { createApp, MAX_BODY_BYTES, type RequestLog } from '../src/app.js';
import { DEMO_OWNER_ID } from '../src/db/demo-data.js';
import type { AppEnv } from '../src/lib/http.js';
import { mutationObject, parsePagination, parseSort, readJson } from '../src/lib/validation.js';

function setup(options: { findOwner?: (id: string) => Promise<boolean>; corsOrigins?: string[] } = {}) {
  const logs: RequestLog[] = [];
  const api = new Hono<AppEnv>();
  api.post('/examples', async (c) => {
    const body = await readJson(c, mutationObject({ name: z.string().min(1).max(100) }));
    return c.json({ data: { ...body, ownerId: c.get('ownerId') } }, 201);
  });
  api.get('/examples/:id', (c) => c.json({ data: { ownerId: c.get('ownerId') } }));
  api.get('/examples', (c) => c.json({ data: {
    ...parsePagination(c.req.queries()), ...parseSort(c.req.queries(), ['name', 'createdAt'], 'createdAt'),
  } }));
  api.get('/failure', () => { throw new Error('password=private-database-secret SQL SELECT'); });
  const app = createApp({ apiRoutes: api, findOwner: () => Promise.resolve(true),
    logRequest: (entry) => { logs.push(entry); }, ...options });
  return { app, logs };
}

function post(body: string, headers: Record<string, string> = {}) {
  return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body };
}

async function errorBody(response: Response) {
  return await response.json() as { error: {
    code: string; message: string; status: number; requestId: string; details?: { path: string; message: string }[];
  } };
}

describe('shared HTTP behavior', () => {
  it('returns consistent errors with server-generated request IDs and security headers', async () => {
    const { app, logs } = setup();
    const response = await app.request('/unknown/private-secret?password=private-secret', {
      headers: { 'X-Request-Id': 'private-secret' },
    });
    const body = await errorBody(response);
    expect(response.status).toBe(404);
    expect(body.error.requestId).toBe(response.headers.get('x-request-id')!);
    expect(body.error.requestId).not.toBe('private-secret');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ method: 'GET', status: 404, path: '[unmatched]' });
    expect(JSON.stringify({ logs, body })).not.toContain('private-secret');
  });

  it('reports malformed JSON as 400 without logging body or credentials', async () => {
    const { app, logs } = setup();
    const response = await app.request('/api/v1/examples?password=private-secret', post('{"password":"private-secret",', {
      authorization: 'Bearer private-secret', cookie: 'session=private-secret',
    }));
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe('INVALID_JSON');
    expect(logs[0]?.status).toBe(400);
    expect(JSON.stringify(logs)).not.toContain('private-secret');
  });

  it('rejects unsupported body formats with the JSON error contract', async () => {
    const { app } = setup();
    const response = await app.request('/api/v1/examples', post('name=secret', { 'content-type': 'text/plain' }));
    expect(response.status).toBe(415);
    expect((await errorBody(response)).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('reports safe field paths and rejects caller-supplied owner fields', async () => {
    const { app } = setup();
    const response = await app.request('/api/v1/examples', post(JSON.stringify({ name: '', ownerId: 'private-secret' })));
    expect(response.status).toBe(422);
    const body = await errorBody(response);
    expect(body.error.details).toEqual([
      { path: 'name', message: 'Invalid value.' },
      { path: '$', message: 'Unexpected fields are not allowed.' },
    ]);
    expect(JSON.stringify(body)).not.toContain('private-secret');
  });

  it('rejects oversized bodies before looking up the owner or parsing JSON', async () => {
    let lookedUp = false;
    const { app } = setup({ findOwner: () => { lookedUp = true; return Promise.resolve(true); } });
    const response = await app.request('/api/v1/examples', post('x'.repeat(MAX_BODY_BYTES + 1)));
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(lookedUp).toBe(false);
  });

  it('also bounds streamed bodies without Content-Length', async () => {
    const { app } = setup();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_BODY_BYTES));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    } });
    const response = await app.request('/api/v1/examples', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.status).toBe(413);
  });

  it('sanitizes unexpected failures and logs the final status', async () => {
    const { app, logs } = setup();
    const response = await app.request('/api/v1/failure');
    expect(response.status).toBe(500);
    const body = await errorBody(response);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify({ body, logs })).not.toContain('private-database-secret');
    expect(logs[0]?.status).toBe(500);
  });

  it('selects the demo owner regardless of owner headers or query fields', async () => {
    const lookedUp: string[] = [];
    const { app, logs } = setup({ findOwner: (id) => { lookedUp.push(id); return Promise.resolve(true); } });
    const response = await app.request('/api/v1/examples/private-id?ownerId=other', { headers: { 'X-Owner-Id': 'other' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ownerId: DEMO_OWNER_ID } });
    expect(lookedUp).toEqual([DEMO_OWNER_ID]);
    expect(logs[0]?.path).toBe('/api/v1/examples/:id');
  });

  it('reports a missing demo owner separately from database failures', async () => {
    const missing = setup({ findOwner: () => Promise.resolve(false) }).app;
    const response = await missing.request('/api/v1/examples');
    expect(response.status).toBe(503);
    expect((await errorBody(response)).error.code).toBe('DEMO_OWNER_MISSING');
    const failing = setup({ findOwner: () => Promise.reject(new Error('private-secret')) }).app;
    const unavailable = await failing.request('/api/v1/examples');
    expect(unavailable.status).toBe(503);
    const body = await errorBody(unavailable);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toContain('private-secret');
    expect((await missing.request('/health/live')).status).toBe(200);
  });

  it('uses bounded pagination and only accepted sort keys and directions', async () => {
    const { app } = setup();
    const defaults = await app.request('/api/v1/examples');
    expect(await defaults.json()).toEqual({ data: { page: 1, limit: 25, offset: 0, sort: 'createdAt', direction: 'desc' } });
    const selected = await app.request('/api/v1/examples?page=3&limit=10&sort=name&direction=asc');
    expect(await selected.json()).toEqual({ data: { page: 3, limit: 10, offset: 20, sort: 'name', direction: 'asc' } });
    for (const query of ['limit=101', 'page=0', 'page=1&page=2', 'sort=private-secret', 'direction=sideways', 'page=9007199254740991']) {
      const response = await app.request(`/api/v1/examples?${query}`);
      expect(response.status).toBe(422);
      expect((await errorBody(response)).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('keeps browser-origin sharing disabled by default and matches the configured allowlist exactly', async () => {
    const disabled = await setup().app.request('/health/live', { headers: { origin: 'http://localhost:5173' } });
    expect(disabled.headers.get('access-control-allow-origin')).toBeNull();
    const { app } = setup({ corsOrigins: ['http://localhost:5173'] });
    const allowed = await app.request('/health/live', { headers: { origin: 'http://localhost:5173' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();
    const denied = await app.request('/health/live', { headers: { origin: 'http://localhost:5173.evil.test' } });
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    const preflight = await app.request('/api/v1/examples', { method: 'OPTIONS', headers: {
      origin: 'http://localhost:5173', 'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });
});
