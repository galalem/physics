import { Hono } from 'hono';

import authRoutes from './auth';
import { tagsRoutes } from './tags';
import { exercisesRoutes } from './exercises';
import myRoutes from './my';
import { attemptsRoutes } from './attempts';
import checkoutRoutes from './checkout';
import webhookRoutes from './webhooks';

const v1 = new Hono();
v1.route('/auth', authRoutes);
v1.route('/tags', tagsRoutes);
v1.route('/exercises', exercisesRoutes);
v1.route('/my', myRoutes);
v1.route('/my/attempts', attemptsRoutes);
v1.route('/checkout', checkoutRoutes);
v1.route('/webhooks', webhookRoutes);

export default v1;