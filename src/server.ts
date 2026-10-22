import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const app = createApp();

serve(
  {
    fetch: app.fetch,
    hostname: '0.0.0.0',
    port: 3000,
  },
  () => {
    console.info('API listening on port 3000');
  },
);
