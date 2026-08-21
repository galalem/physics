import { Hono } from 'hono';
import { z } from 'zod';
import { checkAccess } from '~/lib/access';
import { errors } from '~/lib/error';
import { parsePagination } from '~/lib/page';
import { responses } from '~/lib/response';
import { validate } from '~/lib/validate';
import { requireAuth } from '~/middleware/auth';
import type { AuthedUser } from '~/middleware/auth';
import { Attempt } from '~/models/attempt';
import { Exercise } from '~/models/exercise';

// POST   /my/attempts             start/retry — fresh row, seed accepted from client
// GET    /my/attempts             Page<AttemptSummary>, filters ?exercise= &completed= &succeeded=
// GET    /my/attempts/:id         fetch one (resume flow)
// PATCH  /my/attempts/:id         save state / append to log (~500ms debounce client-side)
// POST   /my/attempts/:id/complete  mark terminal, records `succeeded`

export const attemptsRoutes = new Hono<{ Variables: { user: AuthedUser } }>();

attemptsRoutes.use('*', requireAuth);
attemptsRoutes.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

const CreateBody = z.object({
  exerciseSlug: z.string().min(1, 'exerciseSlug is required.'),
  seed: z.number().int('seed must be an integer.'),
});

const ListQuery = z.object({
  exercise: z.string().min(1).optional(),
  completed: z.enum(['true', 'false']).optional(),
  succeeded: z.enum(['true', 'false']).optional(),
  page: z.string().optional(),
  size: z.string().optional(),
});

const PatchBody = z
  .object({
    savedStateBlob: z.string().optional(),
    savedStateVersion: z.number().int().optional(),
    logAppend: z.array(z.string()).optional(),
  })
  .refine(
    (b) => !(b.savedStateBlob !== undefined && b.savedStateVersion === undefined),
    { message: 'savedStateVersion is required when savedStateBlob is present.', path: ['savedStateVersion'] },
  );

const CompleteBody = z.object({
  succeeded: z.boolean({ error: 'succeeded (boolean) is required.' }),
  logAppend: z.array(z.string()).optional(),
});

attemptsRoutes.post('/', validate('json', CreateBody), async (c) => {
  const { exerciseSlug, seed } = c.req.valid('json');
  const user = c.get('user');
  const exercise = await Exercise.findPlayableBySlug(exerciseSlug);
  if (!exercise) throw errors.resourceMissing(`Exercise not found: ${exerciseSlug}`);
  const tags = await Exercise.tagsFor(exercise.id);
  if (!(await checkAccess(user.id, exercise.tier, tags))) throw errors.entitlementRequired();
  const row = await Attempt.create(user.id, exercise, seed);
  return responses.content(c, Attempt.rowToFull(row), 201);
});

attemptsRoutes.get('/', validate('query', ListQuery), async (c) => {
  const q = c.req.valid('query');
  const user = c.get('user');
  const { page, size } = parsePagination({ page: q.page, size: q.size });
  const { rows, total } = await Attempt.listForUser(
    user.id,
    {
      exerciseSlug: q.exercise,
      completed: q.completed === undefined ? undefined : q.completed === 'true',
      succeeded: q.succeeded === undefined ? undefined : q.succeeded === 'true',
    },
    page,
    size,
  );
  return responses.page(c, rows.map(Attempt.rowToSummary), page, size, total);
});

// Attempt responses do NOT carry bundleUrl — asset-serving concerns live
// on the catalog side. Consumers that need to mount an exercise fetch
// the signed URL via GET /exercises/:slug alongside this attempt data.
attemptsRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const row = await Attempt.findByIdForUser(c.req.param('id'), user.id);
  if (!row) throw errors.resourceMissing();
  return responses.content(c, Attempt.rowToFull(row));
});

attemptsRoutes.patch('/:id', validate('json', PatchBody), async (c) => {
  const user = c.get('user');
  const patch = c.req.valid('json');
  const row = await Attempt.applyPatch(c.req.param('id'), user.id, patch);
  return responses.content(c, Attempt.rowToFull(row));
});

attemptsRoutes.post('/:id/complete', validate('json', CompleteBody), async (c) => {
  const user = c.get('user');
  const { succeeded, logAppend } = c.req.valid('json');
  const row = await Attempt.markComplete(c.req.param('id'), user.id, succeeded, logAppend);
  return responses.content(c, Attempt.rowToFull(row));
});
