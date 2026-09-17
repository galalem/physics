import { useEffect } from 'react'

const SITE_ORIGIN = 'https://physics.galalem.tn'

// Per-route SEO chrome. Mutates `<title>`, `<meta name="description">` and
// `<link rel="canonical">` from inside a page component — the SPA base
// values in index.html cover a cold crawl / first paint, and Googlebot's
// second-pass render picks these up. `noindex: true` swaps the robots
// meta to `noindex,follow` for error/detail pages that shouldn't be
// indexed (missing exercise, etc.).
export function useDocumentHead(opts: {
  title: string
  description?: string
  path?: string
  noindex?: boolean
}) {
  const { title, description, path, noindex } = opts
  useEffect(() => {
    document.title = title
    if (description) setMeta('name', 'description', description)
    if (path) setLink('canonical', `${SITE_ORIGIN}${path}`)
    setMeta('name', 'robots', noindex ? 'noindex,follow' : 'index,follow')
  }, [title, description, path, noindex])
}

function setMeta(attr: 'name' | 'property', key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', value)
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}
