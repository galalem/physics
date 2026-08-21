import { Hono } from 'hono';
import type { Locale } from '~/config';
import { checkAccess, evaluateAccess } from '~/lib/access';
import { sql } from '~/lib/db';
import { errors } from '~/lib/error';
import { indexTranslations, pickLocale, type TranslationRow } from '~/lib/i18n';
import { parsePagination } from '~/lib/page';
import { responses } from '~/lib/response';
import { signBundleUrl } from '~/lib/runtime-signer';
import { type AuthedUser, optionalAuth } from '~/middleware/auth';
import { Attempt } from '~/models/attempt';
import { Entitlement } from '~/models/entitlement';

// GET /exercises          Page<ExerciseSummary>, filters ?q= &tag= (repeatable, parent:slug)
// GET /exercises/:slug    ExerciseDetail + before[]/after[] recommendations
//
// Auth is optional; once auth is wired, authenticated callers will
// additionally see `completed` and `resumableAttemptId` on each item.
//
// Filtering (q, tag) and sorting run in JS for now — the catalog is
// ~100 rows. When it grows or a real fuzzy search is needed, push the
// tag EXISTS + trigram ILIKE into SQL.

export const exercisesRoutes = new Hono<{ Variables: { locale: Locale; user?: AuthedUser } }>();

interface ExerciseRow {
  id: string;
  slug: string;
  formula: string | null;
  tier: string;
}

function parseTagFilter(compounds: string[]): Record<string, string[]> {
  const byParent: Record<string, string[]> = {};
  for (const compound of compounds) {
    const idx = compound.indexOf(':');
    if (idx < 0) {
      throw errors.invalidValue(`Tag must be in "parent:slug" format, got "${compound}".`, [
        { field: 'tag', message: 'Expected parent:slug' },
      ]);
    }
    const parent = compound.slice(0, idx);
    const slug = compound.slice(idx + 1);
    (byParent[parent] ??= []).push(`${parent}:${slug}`);
  }
  return byParent;
}

exercisesRoutes.get('/', optionalAuth, async (c) => {
  const locale = c.get('locale');
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const rawTags = c.req.queries('tag') ?? [];
  const byParent = parseTagFilter(rawTags);
  const { page: pageNum, size } = parsePagination({
    page: c.req.query('page'),
    size: c.req.query('size'),
  });

  const user = c.get('user');

  const [exerciseRows, tagRows, titleRows, recRows, entitlements, attemptStatus] = await Promise.all([
    sql<ExerciseRow[]>`SELECT id, slug, formula, tier FROM exercises WHERE published = true`,
    sql<{ exercise_id: string; compound: string }[]>`
      SELECT et.exercise_id, p.slug || ':' || t.slug AS compound
      FROM exercises_tags et
      JOIN tags t ON t.id = et.tag_id
      JOIN tags p ON p.id = t.parent_id
    `,
    sql<TranslationRow[]>`
      SELECT record_type, record_id, locale, field, value
      FROM translations
      WHERE record_type = 'exercise' AND field = 'title'
    `,
    sql<{ from_id: string; direction: 'before' | 'after'; slug: string }[]>`
      SELECT r.from_id, r.direction, e.slug
      FROM exercises_recommendations r
      JOIN exercises e ON e.id = r.to_id
      WHERE e.published = true
    `,
    user ? Entitlement.activeForUser(user.id) : Promise.resolve([]),
    user ? Attempt.statusByExerciseForUser(user.id) : Promise.resolve(new Map()),
  ]);

  const tagsByExercise = new Map<string, string[]>();
  for (const r of tagRows) {
    const arr = tagsByExercise.get(r.exercise_id) ?? [];
    arr.push(r.compound);
    tagsByExercise.set(r.exercise_id, arr);
  }
  const titles = indexTranslations(titleRows);

  const recsByExercise = new Map<string, { before: string[]; after: string[] }>();
  for (const r of recRows) {
    const entry = recsByExercise.get(r.from_id) ?? { before: [], after: [] };
    entry[r.direction].push(r.slug);
    recsByExercise.set(r.from_id, entry);
  }

  let items = exerciseRows.map((e) => {
    const tags = tagsByExercise.get(e.id) ?? [];
    const recommendations = recsByExercise.get(e.id) ?? { before: [], after: [] };
    const base = {
      slug: e.slug,
      title: pickLocale(titles.get(`${e.id}:title`), locale) ?? e.slug,
      formula: e.formula ?? '',
      tags,
      tier: e.tier,
      recommendations,
    };
    if (!user) return base;
    const status = attemptStatus.get(e.id);
    return {
      ...base,
      accessible: evaluateAccess(e.tier, new Set(tags), entitlements),
      completed: status?.completed ?? false,
      resumable: status?.resumable ?? false,
    };
  });

  // tag filter: AND across parents, OR within parent
  const parentEntries = Object.entries(byParent);
  if (parentEntries.length) {
    items = items.filter((ex) =>
      parentEntries.every(([_, compounds]) => compounds.some((c) => ex.tags.includes(c))),
    );
  }

  if (q) {
    items = items.filter(
      (ex) => ex.title.toLowerCase().includes(q) || ex.slug.toLowerCase().includes(q),
    );
  }

  items.sort((a, b) => a.title.localeCompare(b.title, locale));

  const start = (pageNum - 1) * size;
  return responses.page(c, items.slice(start, start + size), pageNum, size, items.length);
});

exercisesRoutes.get('/:slug', optionalAuth, async (c) => {
  const locale = c.get('locale');
  const slug = c.req.param('slug');
  const user = c.get('user');

  const [exercise] = await sql<
    {
      id: string;
      slug: string;
      formula: string | null;
      version: string;
      bundle_url: string | null;
      tier: string;
    }[]
  >`
    SELECT id, slug, formula, version, bundle_url, tier
    FROM exercises
    WHERE slug = ${slug} AND published = true
  `;
  if (!exercise) throw errors.resourceMissing(`Exercise not found: ${slug}`);

  const [tagRows, translationRows, recRows] = await Promise.all([
    sql<{ compound: string }[]>`
      SELECT p.slug || ':' || t.slug AS compound
      FROM exercises_tags et
      JOIN tags t ON t.id = et.tag_id
      JOIN tags p ON p.id = t.parent_id
      WHERE et.exercise_id = ${exercise.id}
    `,
    sql<TranslationRow[]>`
      SELECT record_type, record_id, locale, field, value
      FROM translations
      WHERE record_type = 'exercise' AND record_id = ${exercise.id}
    `,
    sql<{ direction: 'before' | 'after'; slug: string; id: string }[]>`
      SELECT r.direction, e.slug, e.id
      FROM exercises_recommendations r
      JOIN exercises e ON e.id = r.to_id
      WHERE r.from_id = ${exercise.id} AND e.published = true
    `,
  ]);

  const relatedIds = recRows.map((r) => r.id);
  const relatedTitles = relatedIds.length
    ? await sql<TranslationRow[]>`
        SELECT record_type, record_id, locale, field, value
        FROM translations
        WHERE record_type = 'exercise' AND field = 'title'
          AND record_id IN ${sql(relatedIds)}
      `
    : [];

  const fields = indexTranslations(translationRows);
  const related = indexTranslations(relatedTitles);

  const before = recRows
    .filter((r) => r.direction === 'before')
    .map((r) => ({ slug: r.slug, title: pickLocale(related.get(`${r.id}:title`), locale) ?? r.slug }));
  const after = recRows
    .filter((r) => r.direction === 'after')
    .map((r) => ({ slug: r.slug, title: pickLocale(related.get(`${r.id}:title`), locale) ?? r.slug }));

  const tags = tagRows.map((r) => r.compound);

  // Sign the bundle URL only when the caller both has a session AND passes
  // the access check (free-tier bypass or matching entitlement). Everyone
  // else gets the raw path, which nginx 403s if hit directly.
  let bundleUrl = exercise.bundle_url;
  if (user && exercise.bundle_url && (await checkAccess(user.id, exercise.tier, new Set(tags)))) {
    bundleUrl = signBundleUrl(exercise.bundle_url);
  }

  // Auth-only fields per API-DESIGN: `resumableAttemptId` + `completed`.
  // Lets the topic page skip POST /my/attempts when a live row exists.
  const userExtras = user
    ? await Attempt.resumableAndCompleted(user.id, exercise.id)
    : null;

  return responses.content(c, {
    slug: exercise.slug,
    title: pickLocale(fields.get(`${exercise.id}:title`), locale) ?? exercise.slug,
    formula: exercise.formula ?? '',
    description: pickLocale(fields.get(`${exercise.id}:description`), locale),
    version: exercise.version,
    bundleUrl,
    tier: exercise.tier,
    tags,
    before,
    after,
    ...(userExtras ?? {}),
  });
});
