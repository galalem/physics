import type { Hono } from 'hono';
import { z } from 'zod';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { User } from '~/models/user';
import type { MyEnv } from './types';

// POST /my/tutorial   close the onboarding gate for the current user.
//                     Both outcomes are terminal; the model's first-write-wins
//                     guard means a guest flag syncing after a real completion
//                     cannot downgrade `completed` to `skipped`.

const TutorialBody = z.object({
  outcome: z.enum(['completed', 'skipped'], { error: 'Unknown tutorial outcome.' }),
});

export default function registerRoutes(app: Hono<MyEnv>): void {
  app.post('/tutorial', validate('json', TutorialBody), async (c) => {
    const { outcome } = c.req.valid('json');
    await User.markTutorialDone(c.get('user').id, outcome);
    return responses.empty(c);
  });
}
