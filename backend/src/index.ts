import { serve } from '@hono/node-server';
import { createApp } from './app';
import { config } from './config';
import './templates'; // registers templates

const app = createApp();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
