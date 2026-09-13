import { type Db, sql } from '~/lib/db';
import { errors } from '~/lib/error';
import type { ExerciseRow } from '~/models/exercise';

// DB row + joined exercise slug (needed to reconstruct wire fields).
export interface AttemptRow {
  id: string;
  user_id: string;
  exercise_id: string;
  exercise_slug: string;
  exercise_version: string;
  seed: string; // bigint from pg driver
  started_at: Date;
  last_action_at: Date;
  completed_at: Date | null;
  succeeded: boolean | null;
  saved_state_blob: string | null;
  saved_state_version: number | null;
  log: string;
}

export interface AttemptFull {
  id: string;
  exerciseSlug: string;
  exerciseVersionAtStart: string;
  seed: number;
  startedAt: string;
  lastActionAt: string;
  completedAt: string | null;
  succeeded: boolean;
  savedStateBlob: string | null;
  savedStateVersion: number | null;
  log: string;
}

export interface AttemptSummary {
  id: string;
  exerciseSlug: string;
  exerciseVersionAtStart: string;
  seed: number;
  startedAt: string;
  lastActionAt: string;
  completedAt: string | null;
  succeeded: boolean;
}

export interface AttemptListFilters {
  exerciseSlug?: string | undefined;
  completed?: boolean | undefined;
  succeeded?: boolean | undefined;
}

export interface AttemptPatch {
  savedStateBlob?: string | undefined;
  savedStateVersion?: number | undefined;
  logAppend?: string[] | undefined;
}

const ROW_COLUMNS = sql`
  a.id, a.user_id, a.exercise_id, e.slug AS exercise_slug,
  a.exercise_version, a.seed, a.started_at, a.last_action_at,
  a.completed_at, a.succeeded, a.saved_state_blob,
  a.saved_state_version, a.log
`;

function joinedLog(existing: string, append: string[]): string {
  if (!append.length) return existing;
  const suffix = append.join('\n');
  return existing.length ? `${existing}\n${suffix}` : suffix;
}

export class Attempt {
  static rowToFull(row: AttemptRow): AttemptFull {
    return {
      id: row.id,
      exerciseSlug: row.exercise_slug,
      exerciseVersionAtStart: row.exercise_version,
      seed: Number(row.seed),
      startedAt: row.started_at.toISOString(),
      lastActionAt: row.last_action_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
      succeeded: row.succeeded ?? false,
      savedStateBlob: row.saved_state_blob,
      savedStateVersion: row.saved_state_version,
      log: row.log,
    };
  }

  static rowToSummary(row: AttemptRow): AttemptSummary {
    return {
      id: row.id,
      exerciseSlug: row.exercise_slug,
      exerciseVersionAtStart: row.exercise_version,
      seed: Number(row.seed),
      startedAt: row.started_at.toISOString(),
      lastActionAt: row.last_action_at.toISOString(),
      completedAt: row.completed_at?.toISOString() ?? null,
      succeeded: row.succeeded ?? false,
    };
  }

  static async create(
    userId: string,
    exercise: ExerciseRow,
    seed: number,
    db: Db = sql,
  ): Promise<AttemptRow> {
    const [row] = await db<AttemptRow[]>`
      WITH inserted AS (
        INSERT INTO attempts (user_id, exercise_id, exercise_version, seed)
        VALUES (${userId}, ${exercise.id}, ${exercise.version}, ${seed})
        RETURNING *
      )
      SELECT ${ROW_COLUMNS}
      FROM inserted a
      JOIN exercises e ON e.id = a.exercise_id
    `;
    return row!;
  }

  static async findByIdForUser(
    id: string,
    userId: string,
    db: Db = sql,
  ): Promise<AttemptRow | null> {
    const [row] = await db<AttemptRow[]>`
      SELECT ${ROW_COLUMNS}
      FROM attempts a
      JOIN exercises e ON e.id = a.exercise_id
      WHERE a.id = ${id} AND a.user_id = ${userId}
    `;
    return row ?? null;
  }

  // Admin: one-line activity summary for a user's detail screen. Counts
  // only, no rows — the raw log lives in its own area.
  static async summaryForUser(
    userId: string,
    db: Db = sql,
  ): Promise<{ total: number; completed: number; succeeded: number; lastActivityAt: string | null }> {
    const [row] = await db<
      { total: string; completed: string; succeeded: string; last_at: Date | null }[]
    >`
      SELECT count(*)                                        AS total,
             count(*) FILTER (WHERE completed_at IS NOT NULL) AS completed,
             count(*) FILTER (WHERE succeeded)                AS succeeded,
             max(last_action_at)                             AS last_at
      FROM attempts WHERE user_id = ${userId}
    `;
    return {
      total: Number(row?.total ?? 0),
      completed: Number(row?.completed ?? 0),
      succeeded: Number(row?.succeeded ?? 0),
      lastActivityAt: row?.last_at ? row.last_at.toISOString() : null,
    };
  }

  static async listForUser(
    userId: string,
    filters: AttemptListFilters,
    page: number,
    size: number,
    db: Db = sql,
  ): Promise<{ rows: AttemptRow[]; total: number }> {
    const predicates = [sql`a.user_id = ${userId}`];
    if (filters.exerciseSlug !== undefined) {
      predicates.push(sql`e.slug = ${filters.exerciseSlug}`);
    }
    if (filters.completed === true) predicates.push(sql`a.completed_at IS NOT NULL`);
    if (filters.completed === false) predicates.push(sql`a.completed_at IS NULL`);
    if (filters.succeeded !== undefined) predicates.push(sql`a.succeeded = ${filters.succeeded}`);
    const where = predicates.reduce((acc, cur, i) => (i === 0 ? cur : sql`${acc} AND ${cur}`));

    const offset = (page - 1) * size;
    const [rows, countRows] = await Promise.all([
      db<AttemptRow[]>`
        SELECT ${ROW_COLUMNS}
        FROM attempts a
        JOIN exercises e ON e.id = a.exercise_id
        WHERE ${where}
        ORDER BY a.started_at DESC
        LIMIT ${size} OFFSET ${offset}
      `,
      db<{ n: string }[]>`
        SELECT COUNT(*)::text AS n
        FROM attempts a
        JOIN exercises e ON e.id = a.exercise_id
        WHERE ${where}
      `,
    ]);
    return { rows, total: Number(countRows[0]!.n) };
  }

  // Applies a partial patch. Throws `attempt_completed` (409) if the
  // attempt is terminal. Empty patch is a valid no-op — still bumps
  // `last_action_at`, per the deep-dive keepalive contract.
  static async applyPatch(
    id: string,
    userId: string,
    patch: AttemptPatch,
    db: Db = sql,
  ): Promise<AttemptRow> {
    const [existing] = await db<{ completed_at: Date | null; log: string }[]>`
      SELECT completed_at, log
      FROM attempts
      WHERE id = ${id} AND user_id = ${userId}
    `;
    if (!existing) throw errors.resourceMissing();
    if (existing.completed_at) throw errors.attemptCompleted();

    const nextLog =
      patch.logAppend && patch.logAppend.length
        ? joinedLog(existing.log, patch.logAppend)
        : existing.log;

    const [row] = await db<AttemptRow[]>`
      WITH updated AS (
        UPDATE attempts
        SET
          saved_state_blob    = COALESCE(${patch.savedStateBlob ?? null}, saved_state_blob),
          saved_state_version = COALESCE(${patch.savedStateVersion ?? null}, saved_state_version),
          log                 = ${nextLog},
          last_action_at      = now()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      )
      SELECT ${ROW_COLUMNS}
      FROM updated a
      JOIN exercises e ON e.id = a.exercise_id
    `;
    return row!;
  }

  // Batch equivalent of `resumableAndCompleted` for the catalog list:
  // returns per-exercise `{completed, resumable}` across every exercise
  // the user has ever touched, in a single query. `resumable` requires
  // an in-flight attempt at the exercise's CURRENT version (bundle
  // rebuild invalidates resume — see resumableAndCompleted). Exercises
  // the user has never touched are absent from the map; callers default
  // both flags to false in that case.
  static async statusByExerciseForUser(
    userId: string,
    db: Db = sql,
  ): Promise<Map<string, { completed: boolean; resumable: boolean }>> {
    const rows = await db<{ exercise_id: string; has_completed: boolean; has_resumable: boolean }[]>`
      SELECT
        a.exercise_id,
        bool_or(a.completed_at IS NOT NULL) AS has_completed,
        bool_or(a.completed_at IS NULL AND a.exercise_version = e.version) AS has_resumable
      FROM attempts a
      JOIN exercises e ON e.id = a.exercise_id
      WHERE a.user_id = ${userId}
      GROUP BY a.exercise_id
    `;
    const map = new Map<string, { completed: boolean; resumable: boolean }>();
    for (const r of rows) {
      map.set(r.exercise_id, { completed: r.has_completed, resumable: r.has_resumable });
    }
    return map;
  }

  // Snapshot of the user's history for a single exercise, in one round
  // trip. `resumableAttemptId` = most recently-touched non-completed
  // attempt whose `exercise_version` still matches the current published
  // version (a bundle rebuild between start and resume invalidates the
  // saved state's assumptions AND the old bundle may no longer be on
  // disk, so we don't offer resume across versions). `completed` = any
  // prior terminal attempt exists, regardless of version. Version match
  // is enforced via JOIN so callers don't have to plumb the current
  // version through.
  static async resumableAndCompleted(
    userId: string,
    exerciseId: string,
    db: Db = sql,
  ): Promise<{ resumableAttemptId: string | null; completed: boolean }> {
    const [row] = await db<{ resumable_id: string | null; completed: boolean }[]>`
      SELECT
        (
          SELECT a.id FROM attempts a
          JOIN exercises e ON e.id = a.exercise_id
          WHERE a.user_id = ${userId} AND a.exercise_id = ${exerciseId}
            AND a.exercise_version = e.version
            AND a.completed_at IS NULL
          ORDER BY a.last_action_at DESC
          LIMIT 1
        ) AS resumable_id,
        EXISTS (
          SELECT 1 FROM attempts
          WHERE user_id = ${userId} AND exercise_id = ${exerciseId}
            AND completed_at IS NOT NULL
        ) AS completed
    `;
    return { resumableAttemptId: row!.resumable_id, completed: row!.completed };
  }

  // Idempotent terminal mark. A second call on an already-completed
  // attempt returns the existing row without changing succeeded / log.
  static async markComplete(
    id: string,
    userId: string,
    succeeded: boolean,
    logAppend: string[] | undefined,
    db: Db = sql,
  ): Promise<AttemptRow> {
    const existing = await Attempt.findByIdForUser(id, userId, db);
    if (!existing) throw errors.resourceMissing();
    if (existing.completed_at) return existing;

    const nextLog = logAppend && logAppend.length ? joinedLog(existing.log, logAppend) : existing.log;

    const [row] = await db<AttemptRow[]>`
      WITH updated AS (
        UPDATE attempts
        SET
          completed_at   = now(),
          succeeded      = ${succeeded},
          log            = ${nextLog},
          last_action_at = now()
        WHERE id = ${id} AND user_id = ${userId}
        RETURNING *
      )
      SELECT ${ROW_COLUMNS}
      FROM updated a
      JOIN exercises e ON e.id = a.exercise_id
    `;
    return row!;
  }
}
