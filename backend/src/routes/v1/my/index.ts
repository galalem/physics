import { Hono } from 'hono';
import { requireAuth } from '~/middleware/auth';
import PasswordRoute from './password.route';
import PersonalDataRoute from './personal-data.route';
import ProfileDeleteRoute from './profile-delete.route';
import ProfileReadRoute from './profile-read.route';
import ProfileUpdateRoute from './profile-update.route';
import SubscriptionRoute from './subscription.route';
import type { MyEnv } from './types';

const hono = new Hono<MyEnv>();

// Every /my/* endpoint requires a valid session.
hono.use('*', requireAuth);

const routes: Array<(app: Hono<MyEnv>) => void> = [
  PasswordRoute,
  PersonalDataRoute,
  ProfileDeleteRoute,
  ProfileReadRoute,
  ProfileUpdateRoute,
  SubscriptionRoute,
];

routes.forEach((r) => r(hono));

export default hono;
