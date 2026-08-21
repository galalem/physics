import type { ErrorHandler } from 'hono';
import { HttpError } from '~/lib/error';
import { responses } from '~/lib/response';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    return responses.error(c, err);
  }
  console.error('[unhandled]', err);
  return responses.error(c, {
    status: 500,
    code: 'internal_error',
    message: 'Internal server error.',
  });
};

export function notFoundHandler(c: Parameters<import('hono').NotFoundHandler>[0]) {
  return responses.error(c, {
    status: 404,
    code: 'resource_missing',
    message: `Not found: ${c.req.method} ${c.req.path}`,
  });
}
