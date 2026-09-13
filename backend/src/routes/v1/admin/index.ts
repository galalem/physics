import { Hono } from 'hono';
import { requireAuth, requireRole } from '~/middleware/auth';
import UsersActionsRoute from './users-actions.route';
import UsersInviteRoute from './users-invite.route';
import UsersListRoute from './users-list.route';
import UsersReadRoute from './users-read.route';
import UsersSessionsRoute from './users-sessions.route';
import UsersUpdateRoute from './users-update.route';
import type { AdminEnv } from './types';

const hono = new Hono<AdminEnv>();

// Every /admin/* endpoint requires a valid session AND the admin role.
hono.use('*', requireAuth);
hono.use('*', requireRole('admin'));

const routes: Array<(app: Hono<AdminEnv>) => void> = [
  UsersListRoute,
  UsersInviteRoute,
  UsersReadRoute,
  UsersUpdateRoute,
  UsersActionsRoute,
  UsersSessionsRoute,
];

routes.forEach((r) => r(hono));

export default hono;
