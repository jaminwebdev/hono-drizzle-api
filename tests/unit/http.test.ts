import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { ApiError, installHttp, readJson, type HttpEnv } from '../../src/http';

function fixture() {
  const app = new Hono<HttpEnv>();
  installHttp(app);
  app.get('/status', (c) => c.json({ status: 'ok' }));
  app.post('/json', async (c) => c.json({ data: await readJson(c) }));
  app.get('/unexpected', () => { throw new Error('synthetic-secret-never-log'); });
  app.get('/expected', () => { throw new ApiError(400, 'INVALID_INPUT', 'A field is invalid.'); });
  return app;
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('X-Request-Id')).toMatch(/^[a-f\d-]{36}$/);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
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

  test('uses the common error shape for a missing URL', async () => {
    await expectError(await fixture().request('/missing?secret=not-returned'), 404, 'NOT_FOUND');
  });

  test('distinguishes an unsupported method from a missing URL', async () => {
    const app = fixture();
    const response = await app.request('/status', { method: 'POST' });
    await expectError(response, 405, 'METHOD_NOT_ALLOWED');
    expect(response.headers.get('Allow')).toBe('GET, HEAD');
    await expectError(await app.request('/missing', { method: 'POST' }), 404, 'NOT_FOUND');
    const head = await app.request('/status', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
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

describe('JSON request parsing', () => {
  test.each(['application/json', 'application/json; charset=UTF-8'])(
    'accepts %s', async (contentType) => {
      const response = await fixture().request('/json', {
        method: 'POST', headers: { 'Content-Type': contentType }, body: '{"name":"example"}',
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { name: 'example' } });
    },
  );

  test.each(['', '{"password":"synthetic-secret",', 'not JSON'])(
    'rejects malformed or empty JSON without returning submitted data', async (body) => {
      const response = await fixture().request('/json', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      expect(await response.clone().text()).not.toContain('synthetic-secret');
      await expectError(response, 400, 'INVALID_INPUT');
    },
  );

  test.each(['text/plain', 'application/x-www-form-urlencoded'])(
    'rejects an unsupported content type: %s', async (contentType) => {
      await expectError(await fixture().request('/json', {
        method: 'POST', headers: { 'Content-Type': contentType }, body: '{}',
      }), 415, 'UNSUPPORTED_MEDIA_TYPE');
    },
  );

  test('accepts exactly 64 KiB and rejects a declared oversized body', async () => {
    const app = fixture();
    const body = '"' + 'a'.repeat(65534) + '"';
    const headers = { 'Content-Type': 'application/json' };
    expect((await app.request('/json', { method: 'POST', headers, body })).status).toBe(200);
    await expectError(await app.request('/json', {
      method: 'POST', headers: { ...headers, 'Content-Length': '65537' }, body: body + ' ',
    }), 413, 'PAYLOAD_TOO_LARGE');
  });

  test('counts UTF-8 bytes rather than characters', async () => {
    await expectError(await fixture().request('/json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '"' + 'é'.repeat(32768) + '"',
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
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    }), 413, 'PAYLOAD_TOO_LARGE');
  });
});
