import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { ApiError, installHttp, readJson, type HttpEnv } from '../../src/http';

const apiOrigin = 'http://127.0.0.1:3000';
const browserOrigin = 'http://localhost:5173';
let log: ReturnType<typeof spyOn<typeof console, 'log'>>;

beforeEach(() => { log = spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { log.mockRestore(); });

function fixture(corsOrigins: string[] = []) {
  const app = new Hono<HttpEnv>();
  installHttp(app, { API_ORIGIN: apiOrigin, CORS_ORIGINS: corsOrigins });
  app.get('/status', (c) => c.json({ status: 'ok' }));
  app.post('/json', async (c) => c.json({ data: await readJson(c) }));
  app.get('/unexpected', () => { throw new Error('synthetic-secret-never-log'); });
  app.get('/expected', () => { throw new ApiError(400, 'INVALID_INPUT', 'A field is invalid.'); });
  app.get('/missing-record', () => { throw new ApiError(404, 'NOT_FOUND', 'The record was not found.'); });
  app.post('/records/:id', async (c) => {
    await readJson(c);
    c.header('Set-Cookie', 'synthetic-session=never-log');
    return c.json({ status: 'ok' });
  });
  return app;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('X-Request-Id')).toMatch(/^[a-f\d-]{36}$/);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('Content-Type')).toContain('application/json');
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(await response.json()).toMatchObject({
    error: { status, code, requestId: response.headers.get('X-Request-Id'), timestamp: expect.any(String) as unknown },
  });
}

describe('common HTTP responses', () => {
  test('generates its own request ID and sets response headers', async () => {
    const response = await fixture().request('/status', { headers: { 'X-Request-Id': 'client-supplied' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Request-Id')).toMatch(/^[a-f\d-]{36}$/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.has('Strict-Transport-Security')).toBe(false);
  });

  test('returns JSON regardless of the Accept header', async () => {
    const response = await fixture().request('/status', { headers: { Accept: 'text/html' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('uses the common error shape for a missing URL', async () => {
    await expectError(await fixture().request('/missing?secret=not-returned'), 404, 'NOT_FOUND');
  });

  test('distinguishes an unsupported method from a missing URL', async () => {
    const app = fixture();
    const response = await app.request('/status', { method: 'POST', headers: { Origin: apiOrigin } });
    await expectError(response, 405, 'METHOD_NOT_ALLOWED');
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    await expectError(await app.request('/missing', { method: 'POST', headers: { Origin: apiOrigin } }), 404, 'NOT_FOUND');
    const head = await app.request('/status', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  test('preserves a route-specific 404 and still detects unsupported methods on that route', async () => {
    const app = fixture();
    const response = await app.request('/missing-record');
    await expectError(response.clone(), 404, 'NOT_FOUND');
    expect(await response.json()).toMatchObject({ error: { message: 'The record was not found.' } });
    const unsupported = await app.request('/missing-record', { method: 'POST', headers: { Origin: apiOrigin } });
    await expectError(unsupported, 405, 'METHOD_NOT_ALLOWED');
    expect(unsupported.headers.get('Allow')).toBe('GET, HEAD');
  });

  test('hides unexpected error messages and preserves explicit safe errors', async () => {
    const app = fixture();
    const response = await app.request('/unexpected');
    expect(await response.clone().text()).not.toContain('synthetic-secret-never-log');
    await expectError(response, 500, 'INTERNAL_ERROR');
    await expectError(await app.request('/expected'), 400, 'INVALID_INPUT');
  });

  test('limits the full URL to 8 KiB', async () => {
    const base = 'http://localhost/status?q=';
    const allowed = base + 'a'.repeat(8192 - base.length);
    const app = fixture();
    expect((await app.request(allowed)).status).toBe(200);
    await expectError(await app.request(allowed + 'a'), 414, 'URI_TOO_LONG');
  });
});

describe('safe request logging', () => {
  test('logs only metadata and the route template', async () => {
    const response = await fixture().request('/records/private-record-id?secret=query-secret', {
      method: 'POST',
      headers: {
        Origin: apiOrigin, 'Content-Type': 'application/json',
        Authorization: 'Bearer header-secret', Cookie: 'session=cookie-secret',
        'X-CSRF-Token': 'csrf-secret',
      },
      body: '{"description":"body-secret"}',
    });
    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line) as unknown).toEqual({
      requestId: response.headers.get('X-Request-Id'), method: 'POST', route: '/records/:id', status: 200,
      elapsedMs: expect.any(Number) as unknown,
    });
    for (const secret of ['private-record-id', 'query-secret', 'header-secret', 'cookie-secret',
      'csrf-secret', 'body-secret', 'synthetic-session', 'never-log']) {
      expect(line).not.toContain(secret);
    }
  });

  test('logs the final status for early and unexpected failures without request details', async () => {
    const app = fixture();
    const requests = [
      { url: '/json', init: { method: 'POST' }, status: 403 },
      { url: '/status', init: { method: 'POST', headers: { Origin: apiOrigin } }, status: 405 },
      { url: '/status?' + 'x'.repeat(8192), init: {}, status: 414 },
      { url: '/unexpected', init: {}, status: 500 },
      { url: '/missing/private-missing-id?secret=hidden', init: {}, status: 404 },
    ];
    for (const request of requests) {
      log.mockClear();
      const response = await app.request(request.url, request.init);
      expect(response.status).toBe(request.status);
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]?.[0]);
      expect(JSON.parse(line) as unknown).toMatchObject({ status: request.status });
      expect(line).not.toContain('private-missing-id');
      expect(line).not.toContain('hidden');
      expect(line).not.toContain('synthetic-secret-never-log');
    }
  });
});

describe('JSON request parsing', () => {
  test.each(['application/json', 'application/json; charset=UTF-8'])(
    'accepts %s', async (contentType) => {
      const response = await fixture().request('/json', {
        method: 'POST', headers: { 'Content-Type': contentType, Origin: apiOrigin }, body: '{"name":"example"}',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { name: 'example' } });
    },
  );

  test.each(['', '{"password":"synthetic-secret",', 'not JSON'])(
    'rejects malformed or empty JSON without returning submitted data', async (body) => {
      const response = await fixture().request('/json', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: apiOrigin }, body,
      });
      expect(await response.clone().text()).not.toContain('synthetic-secret');
      await expectError(response, 400, 'INVALID_INPUT');
    },
  );

  test.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'rejects an unsupported content type: %s', async (contentType) => {
      await expectError(await fixture().request('/json', {
        method: 'POST', headers: { 'Content-Type': contentType, Origin: apiOrigin }, body: '{}',
      }), 415, 'UNSUPPORTED_MEDIA_TYPE');
    },
  );

  test('accepts exactly 64 KiB and rejects a declared oversized body', async () => {
    const app = fixture();
    const body = '"' + 'a'.repeat(65534) + '"';
    const headers = { 'Content-Type': 'application/json', Origin: apiOrigin };
    expect((await app.request('/json', { method: 'POST', headers, body })).status).toBe(200);
    await expectError(await app.request('/json', {
      method: 'POST', headers: { ...headers, 'Content-Length': '65537' }, body: body + ' ',
    }), 413, 'PAYLOAD_TOO_LARGE');
  });

  test('counts UTF-8 bytes rather than characters', async () => {
    await expectError(await fixture().request('/json', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: apiOrigin }, body: '"' + 'é'.repeat(32768) + '"',
    }), 413, 'PAYLOAD_TOO_LARGE');
  });

  test('rejects an oversized streamed body without a Content-Length', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32768).fill(32));
        controller.enqueue(new Uint8Array(32769).fill(32));
        controller.close();
      },
    });
    await expectError(await fixture().request('/json', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: apiOrigin }, body,
    }), 413, 'PAYLOAD_TOO_LARGE');
  });
});

describe('request origins and CORS', () => {
  test.each([undefined, 'null', 'http://untrusted.example', apiOrigin + '/', apiOrigin + '.untrusted.example'])(
    'rejects a missing or unapproved write origin: %s', async (origin) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (origin !== undefined) headers.Origin = origin;
      await expectError(await fixture().request('/json', { method: 'POST', headers, body: '{}' }),
        403, 'ORIGIN_REJECTED');
    },
  );

  test.each(['PUT', 'PATCH', 'DELETE'])('checks origins for %s too', async (method) => {
    await expectError(await fixture().request('/json', { method }), 403, 'ORIGIN_REJECTED');
  });

  test('health-like GET and HEAD requests need no Origin and CORS is off by default', async () => {
    const app = fixture();
    const response = await app.request('/status', { headers: { Origin: browserOrigin } });
    expect(response.status).toBe(200);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
    expect((await app.request('/status', { method: 'HEAD' })).status).toBe(200);
  });

  test('uses the explicit browser origin with credentials and exposes response metadata', async () => {
    const response = await fixture([browserOrigin]).request('/json', {
      method: 'POST', headers: { Origin: browserOrigin, 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(browserOrigin);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('ETag,Location,X-Request-Id');
    expect(response.headers.get('Vary')).toContain('Origin');
  });

  test('allowed browsers can read safe error responses too', async () => {
    const response = await fixture([browserOrigin]).request('/json', {
      method: 'POST', headers: { Origin: browserOrigin, 'Content-Type': 'application/json' }, body: '{',
    });
    await expectError(response, 400, 'INVALID_INPUT');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(browserOrigin);
  });

  test('does not grant browser access to an unlisted origin', async () => {
    const response = await fixture([browserOrigin]).request('/status', { headers: { Origin: 'http://other.example' } });
    expect(response.status).toBe(200);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  test('answers an allowed browser preflight using explicit methods and headers', async () => {
    const response = await fixture([browserOrigin]).request('/json', { method: 'OPTIONS', headers: {
      Origin: browserOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type,X-CSRF-Token',
    } });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(browserOrigin);
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type,X-CSRF-Token,If-Match');
    expect(response.headers.get('Access-Control-Allow-Methods')).not.toContain('*');
  });

  test('leaves preflight handling to Hono without granting unlisted origins access', async () => {
    const disabled = await fixture().request('/json', { method: 'OPTIONS', headers: {
      Origin: apiOrigin, 'Access-Control-Request-Method': 'POST',
    } });
    await expectError(disabled, 405, 'METHOD_NOT_ALLOWED');
    expect(disabled.headers.has('Access-Control-Allow-Origin')).toBe(false);

    const app = fixture([browserOrigin]);
    for (const origin of [undefined, 'null', 'http://untrusted.example']) {
      const headers: Record<string, string> = { 'Access-Control-Request-Method': 'POST' };
      if (origin !== undefined) headers.Origin = origin;
      const response = await app.request('/json', { method: 'OPTIONS', headers });
      expect(response.status).toBe(204);
      expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    }
  });
});
