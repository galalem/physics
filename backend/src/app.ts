import { Hono } from 'hono';
import { errorHandler, notFoundHandler } from './middleware/error';
import { locale } from './middleware/locale';
import v1 from './routes/v1/index';

export function createApp() {
  const app = new Hono();

  app.use('*', locale);

  app.get('/health', (c) => c.text('ok'));

  app.route('/api/v1', v1);

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}
