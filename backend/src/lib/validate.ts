import { zValidator } from '@hono/zod-validator';
import type { z } from 'zod';
import { errors } from './error';

type Target = 'json' | 'query' | 'param' | 'header' | 'form' | 'cookie';

// `zValidator` wired to our unified error schema. On any failure, flattens
// every issue in the ZodError into an `errors.invalidValue(msg, fields[])`
// throw — same wire shape as the hand-rolled validators, so the frontend
// keeps working unchanged.
//
// Usage: `app.post('/x', validate('json', BodySchema), handler)`
// Inside the handler: `c.req.valid('json')` returns the parsed + narrowed value.
export function validate<T extends z.ZodType, TT extends Target>(target: TT, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw errors.invalidValue(
        'Some fields are invalid.',
        result.error.issues.map((i) => ({
          field: i.path.map(String).join('.') || '(root)',
          message: i.message,
        })),
      );
    }
  });
}
