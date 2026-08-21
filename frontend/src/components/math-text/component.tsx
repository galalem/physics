import type katex from 'katex'

// KaTeX is loaded from jsDelivr in index.html — see the two <link>/<script>
// tags. Reading it off window at render time avoids bundling ~280 KB.
declare global {
  interface Window {
    katex?: typeof katex
  }
}

// Renders a string that may contain inline math wrapped in `$...$`.
// Prose stays as text nodes; each `$...$` span is KaTeX-rendered.
//
// `stacked`: when true, each math span becomes block-level (one per line) and
// pure-whitespace text between them is dropped. Use for pure-formula fields
// like `exercise.formula` inside narrow cards. Leave off for prose+math.
export function MathText({
  children,
  block = false,
  stacked = false,
}: {
  children: string
  block?: boolean
  stacked?: boolean
}) {
  const parts = splitOnMath(children)
  const spanStyle = stacked ? { display: 'block' as const } : undefined
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'math') {
          return (
            <span
              key={i}
              dir="ltr"
              style={{ unicodeBidi: 'isolate', whiteSpace: 'nowrap', ...(spanStyle ?? {}) }}
              dangerouslySetInnerHTML={{ __html: renderMath(p.value, block) }}
            />
          )
        }
        if (stacked && /^[\s;]*$/.test(p.value)) return null
        return <span key={i}>{p.value}</span>
      })}
    </>
  )
}

function renderMath(tex: string, block: boolean): string {
  if (!window.katex) return tex // CDN not yet loaded — degrade to raw source
  return window.katex.renderToString(tex, {
    displayMode: block,
    throwOnError: false,
    strict: 'ignore',
  })
}

type Part = { type: 'text'; value: string } | { type: 'math'; value: string }

function splitOnMath(input: string): Part[] {
  const out: Part[] = []
  let i = 0
  while (i < input.length) {
    const start = input.indexOf('$', i)
    if (start === -1) {
      out.push({ type: 'text', value: input.slice(i) })
      break
    }
    if (start > i) out.push({ type: 'text', value: input.slice(i, start) })
    const end = input.indexOf('$', start + 1)
    if (end === -1) {
      // Unmatched $ — treat rest as prose to avoid breaking the render.
      out.push({ type: 'text', value: input.slice(start) })
      break
    }
    out.push({ type: 'math', value: input.slice(start + 1, end) })
    i = end + 1
  }
  return out
}
