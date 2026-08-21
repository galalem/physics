import type { Locale } from '~/config';
import type { AuthedUser } from '~/middleware/auth';

// Every /my/* route runs after requireAuth (so `user` is always attached)
// and the global locale middleware (so `locale` is always set from
// Accept-Language).
export type MyEnv = { Variables: { user: AuthedUser; locale: Locale } };
