import { describe, expect, it } from 'bun:test';
import { createApp } from '../src/app.js';

describe('HTTP foundation', () => {
  it('reports that the process is alive without a database', async () => {
    const response = await createApp().request('/health/live');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ data: { status: 'ok' } });
  });

  it.each(['/missing', '/api/v1/accounts?password=do-not-echo'])(
    'returns a JSON error for an unknown route: %s',
    async (path) => {
      const response = await createApp().request(path);
      const requestId = response.headers.get('x-request-id');

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(requestId).toBeTruthy();
      expect(await response.json()).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found.',
          status: 404,
          requestId,
        },
      });
    },
  );
});
