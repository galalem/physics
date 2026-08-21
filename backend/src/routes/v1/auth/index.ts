import { Hono } from 'hono';
import type { AuthEnv } from './types';
import CheckRoute from './check.route';
import LoginRoute from './login.route';
import LogoutRoute from './logout.route';
import PasswordResetRoute from './password-reset.route';
import SignupRoute from './signup.route';
import VerifyEmailRoute from './verify-email.route';

const hono = new Hono<AuthEnv>();

const routes:Array<(app:Hono<AuthEnv>)=>void> = [
    CheckRoute,
    LoginRoute,
    LogoutRoute,
    PasswordResetRoute,
    SignupRoute,
    VerifyEmailRoute
];

routes.forEach(r => r(hono));

export default hono