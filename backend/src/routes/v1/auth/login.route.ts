import type { Hono } from 'hono';
import { z } from 'zod';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { Session } from '~/models/session';
import { User } from '~/models/user';
import { clientIp } from './rate-limit.helper';
import { setSessionCookie } from './session.helper';
import type { AuthEnv } from './types';

const LoginBody = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .toLowerCase()
    .pipe(z.email('Email format is invalid.')),
  password: z
    .string({ error: 'Password is required.' })
    .min(1, 'Password is required.'),
});

export default function registerRoutes(app: Hono<AuthEnv>): void {
  app.post('/login', validate('json', LoginBody), async (c) => {
    const { email, password } = c.req.valid('json');

    // Authenticate: rate-limit / decoy / verify / lock / email-verified gate
    // all handled by the model. Throws the correct HttpError on any failure.
    const user = await User.authenticateWithPassword(email, password, clientIp(c));

    // Issue the credential — for this endpoint, a session cookie. A future
    // /auth/token would call User.authenticateWithPassword identically and
    // issue a JWT instead. Same auth policy, different issuance.
    const token = await Session.create(user.id, c.req.header('user-agent') ?? null);
    setSessionCookie(c, token);

    c.header('Cache-Control', 'no-store');
    return responses.mutation(c, user.id, 'Logged in.');
  });
}
