import { Hono } from 'hono';
import { requireAuth } from '~/middleware/auth';
import StartRoute from './start.route';
import type { CheckoutEnv } from './types';

const hono = new Hono<CheckoutEnv>();

hono.use('*', requireAuth);
hono.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

const routes: Array<(app: Hono<CheckoutEnv>) => void> = [StartRoute];
routes.forEach((r) => r(hono));

export default hono;
