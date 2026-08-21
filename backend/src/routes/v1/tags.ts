import { Hono } from 'hono';
import type { Locale } from '~/config';
import { sql } from '~/lib/db';
import { indexTranslations, pickLocale, type TranslationRow } from '~/lib/i18n';
import { responses } from '~/lib/response';

// GET /tags → bare array of root tags (formerly "families") with nested
// leaf tags, each label localized. Both roots and leaves ordered by
// their `index` column (index itself is not returned).

export const tagsRoutes = new Hono<{ Variables: { locale: Locale } }>();

tagsRoutes.get('/', async (c) => {
  const locale = c.get('locale');

  const [rootRows, leafRows, translationRows] = await Promise.all([
    sql<{ id: string; slug: string; index: number }[]>`
      SELECT id, slug, index FROM tags WHERE parent_id IS NULL ORDER BY index
    `,
    sql<{ id: string; parent_id: string; slug: string; index: number }[]>`
      SELECT id, parent_id, slug, index FROM tags WHERE parent_id IS NOT NULL ORDER BY index
    `,
    sql<TranslationRow[]>`
      SELECT record_type, record_id, locale, field, value
      FROM translations
      WHERE record_type = 'tag' AND field = 'label'
    `,
  ]);

  const labels = indexTranslations(translationRows);

  type LeafRow = { id: string; parent_id: string; slug: string; index: number };
  const leavesByRoot = new Map<string, LeafRow[]>();
  for (const t of leafRows) {
    const arr = leavesByRoot.get(t.parent_id) ?? [];
    arr.push(t);
    leavesByRoot.set(t.parent_id, arr);
  }

  const families = rootRows.map((f) => ({
    slug: f.slug,
    label: pickLocale(labels.get(`${f.id}:label`), locale) ?? f.slug,
    tags: (leavesByRoot.get(f.id) ?? []).map((t) => ({
      slug: t.slug,
      label: pickLocale(labels.get(`${t.id}:label`), locale) ?? t.slug,
    })),
  }));

  return responses.content(c, families);
});
