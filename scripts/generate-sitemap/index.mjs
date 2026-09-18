#!/usr/bin/env node
/**
 * pnpm generate-sitemap
 *
 * Regenerates frontend/public/sitemap.xml from docs/curriculum/exercises/_index.json
 * and a hardcoded list of marketing routes. Committed output is what
 * production serves — rerun after adding or removing an exercise.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const ORIGIN = 'https://physics.galalem.tn'

const STATIC_ROUTES = [
  { path: '/', priority: '1.0' },
  { path: '/pricing', priority: '0.9' },
  { path: '/tutorial', priority: '0.9' },
  { path: '/privacy', priority: '0.3' },
  { path: '/terms', priority: '0.3' },
]

async function main() {
  const indexPath = resolve(ROOT, 'docs/curriculum/exercises/_index.json')
  const raw = await readFile(indexPath, 'utf8')
  const parsed = JSON.parse(raw)
  const slugs = Array.isArray(parsed.exercises) ? parsed.exercises : []
  if (slugs.length === 0) {
    throw new Error(`No exercises found in ${indexPath}`)
  }

  const today = new Date().toISOString().slice(0, 10)
  const urls = [
    ...STATIC_ROUTES.map((r) => urlEntry(`${ORIGIN}${r.path}`, today, r.priority)),
    ...slugs.map((slug) => urlEntry(`${ORIGIN}/exercises/${slug}`, today, '0.8')),
  ]

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join('') +
    `</urlset>\n`

  const out = resolve(ROOT, 'frontend/public/sitemap.xml')
  await writeFile(out, xml, 'utf8')
  console.log(`Wrote ${urls.length} URLs to ${out}`)
}

function urlEntry(loc, lastmod, priority) {
  return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${priority}</priority>\n  </url>\n`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
