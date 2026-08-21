#!/usr/bin/env node
/**
 * Aggregate all exercise builds into a single folder for the runtime container.
 *
 * Input:  exercises/<slug>/dist/          (produced by `pnpm --filter './exercises/*' build`)
 * Output: runtime/container/dist/<slug>-v<version>/
 *
 * Slug = folder name under exercises/.
 * Version = the exercise's package.json `version` field.
 *
 * Run: node runtime/container/build.mjs
 * (Also invoked in runtime/container/Dockerfile.)
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')
const EXERCISES_DIR = join(REPO_ROOT, 'exercises')
const OUTPUT_DIR = join(__dirname, 'dist')

// Clean output
if (existsSync(OUTPUT_DIR)) rmSync(OUTPUT_DIR, { recursive: true, force: true })
mkdirSync(OUTPUT_DIR, { recursive: true })

if (!existsSync(EXERCISES_DIR)) {
  console.warn('build.mjs: no exercises/ directory — nothing to aggregate.')
  process.exit(0)
}

const slugs = readdirSync(EXERCISES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)

let ok = 0
let skipped = 0

for (const slug of slugs) {
  const dir = join(EXERCISES_DIR, slug)
  const pkgPath = join(dir, 'package.json')
  const distPath = join(dir, 'dist')

  if (!existsSync(pkgPath)) {
    skipped++
    continue
  }
  if (!existsSync(distPath)) {
    console.warn(`  ⚠ ${slug}: no dist/ — did you run 'pnpm build' for it?`)
    skipped++
    continue
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  const version = pkg.version ?? '0.0.0'
  const target = join(OUTPUT_DIR, `${slug}-v${version}`)

  cpSync(distPath, target, { recursive: true })
  console.log(`  ✓ ${slug} → ${slug}-v${version}/`)
  ok++
}

console.log(`\nbuild.mjs: aggregated ${ok} exercise${ok === 1 ? '' : 's'} (${skipped} skipped) → ${OUTPUT_DIR}`)
