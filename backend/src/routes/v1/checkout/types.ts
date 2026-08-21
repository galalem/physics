import type { Locale } from '~/config';
import type { AuthedUser } from '~/middleware/auth';

export interface CheckoutEnv {
  Variables: { user: AuthedUser; locale?: Locale };
}
