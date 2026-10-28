import { Hono } from 'hono';

const app = new Hono();

app.get('/health/live', (c) => {
  return c.json({ status: 'ok' });
});

export default app;
