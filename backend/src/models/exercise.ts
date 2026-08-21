import { type Db, sql } from '~/lib/db';

export interface ExerciseRow {
  id: string;
  slug: string;
  version: string;
  bundle_url: string;
  tier: string;
}

export class Exercise {
  static async findPlayableBySlug(slug: string, db: Db = sql): Promise<ExerciseRow | null> {
    const [row] = await db<ExerciseRow[]>`
      SELECT id, slug, version, bundle_url, tier
      FROM exercises
      WHERE slug = ${slug} AND published = true AND bundle_url IS NOT NULL
    `;
    return row ?? null;
  }

  static async tagsFor(exerciseId: string, db: Db = sql): Promise<Set<string>> {
    const rows = await db<{ compound: string }[]>`
      SELECT p.slug || ':' || t.slug AS compound
      FROM exercises_tags et
      JOIN tags t ON t.id = et.tag_id
      JOIN tags p ON p.id = t.parent_id
      WHERE et.exercise_id = ${exerciseId}
    `;
    return new Set(rows.map((r) => r.compound));
  }
}
