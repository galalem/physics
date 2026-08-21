import { marked } from 'marked'
import { useMemo } from 'react'
import './styles.scss'

type Vars = Record<string, string>

interface Props {
  /** Map of localized markdown sources, keyed by anything (usually locale or filename). */
  sources: Record<string, string>
  /** Current locale (e.g. "en", "fr"). Falls back to English if the locale is missing. */
  locale: string
  /** Substitutions for `{token}` placeholders in the markdown. */
  vars?: Vars
}

const FALLBACK_LOCALE = 'en'

marked.setOptions({ gfm: true, breaks: false })

export function MarkdownDoc({ sources, locale, vars }: Props) {
  const html = useMemo(() => {
    const source = pickSource(sources, locale) ?? pickSource(sources, FALLBACK_LOCALE) ?? ''
    const rendered = marked.parse(source, { async: false }) as string
    return applyVars(rendered, vars)
  }, [sources, locale, vars])

  return (
    <article
      className="markdown-doc"
      // trusted: sources are our own bundled .md files, vars are our own constants
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted source
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function pickSource(sources: Record<string, string>, locale: string): string | undefined {
  const key = Object.keys(sources).find((k) => k.endsWith(`.${locale}.md`))
  return key ? sources[key] : undefined
}

function applyVars(html: string, vars?: Vars): string {
  if (!vars) return html
  return html.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : escapeHtml(value)
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
