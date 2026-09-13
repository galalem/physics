import type { Locale } from '~/config';
import type { AuthedUser } from '~/middleware/auth';

// Every /admin/* route runs after requireAuth + requireRole('admin'), so
// `user` is always attached and always an admin.
export type AdminEnv = { Variables: { user: AuthedUser; locale: Locale } };
