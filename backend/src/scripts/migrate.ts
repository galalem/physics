import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '~/lib/db';

// Tiny forward-only migration runner. Scans `backend/migrations/*.sql`,
// applies any not yet in `_migrations`, in filename order. Each file
// runs inside a transaction; failure rolls back and stops the run.
//
// Adding a migration = drop a new `NNN_name.sql` in the migrations dir.

const migrationsDir = fileURLToPath(new URL('../../migrations/', import.meta.url));

await sql`
  CREATE TABLE IF NOT EXISTS _migrations (
    id         text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

const appliedRows = await sql<{ id: string }[]>`SELECT id FROM _migrations`;
const applied = new Set(appliedRows.map((r) => r.id));

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const contents = readFileSync(join(migrationsDir, file), 'utf8');
  console.log(`→ applying ${file}`);
  await sql.begin(async (tx) => {
    await tx.unsafe(contents);
    await tx`INSERT INTO _migrations (id) VALUES (${file})`;
  });
  ran++;
}

console.log(ran === 0 ? '✓ up to date' : `✓ applied ${ran} migration(s)`);
await sql.end();
