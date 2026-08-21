import { Hono } from 'hono';
import GalalemPaymentsRoute from './galalem-payments.route';

const hono = new Hono();

const routes: Array<(app: Hono) => void> = [GalalemPaymentsRoute];
routes.forEach((r) => r(hono));

export default hono;
