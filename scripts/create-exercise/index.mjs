#!/usr/bin/env node
/**
 * pnpm new-exercise <slug>
 *
 * Scaffolds a new exercise under exercises/<slug>/ with the O/E/E starter
 * skeleton. Author replaces src/Scene.tsx + i18n/*.json with real content.
 *
 * Slug rules: lowercase kebab-case, must start with a letter, no trailing dash.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

function main() {
  const slug = process.argv[2]

  if (!slug) {
    console.error('Usage: pnpm new-exercise <slug>')
    console.error('Example: pnpm new-exercise reflexion-lumiere')
    process.exit(1)
  }

  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    console.error(`Invalid slug: "${slug}"`)
    console.error('Slug must be lowercase kebab-case, start with a letter, no trailing dash.')
    process.exit(1)
  }

  const exerciseDir = join(REPO_ROOT, 'exercises', slug)
  if (existsSync(exerciseDir)) {
    console.error(`exercises/${slug}/ already exists — refusing to overwrite.`)
    process.exit(1)
  }

  const title = slug
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

  const files = {
    'package.json': pkgJson(slug),
    'tsconfig.json': tsconfig(),
    'vite.config.ts': viteConfig(),
    'index.html': indexHtml(title),
    'src/main.tsx': mainTsx(slug),
    'src/Scene.tsx': sceneTsx(),
    'src/stages.ts': stagesTs(),
    'i18n/en.json': i18nJson(EN),
    'i18n/fr.json': i18nJson(FR),
    'i18n/ar.json': i18nJson(AR),
  }

  for (const [rel, content] of Object.entries(files)) {
    const fullPath = join(exerciseDir, rel)
    mkdirSync(dirname(fullPath), { recursive: true })
    writeFileSync(fullPath, content, 'utf-8')
  }

  console.log(`\n✓ Scaffolded exercises/${slug}/`)
  console.log('\nNext steps:')
  console.log('  1. pnpm install                        # link workspace deps')
  console.log(`  2. cd exercises/${slug} && pnpm dev    # standalone dev with preview`)
  console.log('  3. Replace src/Scene.tsx + i18n/*.json with your actual content')
  console.log('')
}

// ─────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────

const pkgJson = (slug) =>
  JSON.stringify(
    {
      name: slug,
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        typecheck: 'tsc --noEmit',
      },
      dependencies: {
        '@physics/sdk': 'workspace:*',
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
      devDependencies: {
        '@physics/preview': 'workspace:*',
        '@types/react': '^18.3.12',
        '@types/react-dom': '^18.3.1',
        '@vitejs/plugin-react': '^4.3.3',
        typescript: '^5.7.2',
        vite: '^5.4.11',
      },
    },
    null,
    2,
  ) + '\n'

const tsconfig = () =>
  JSON.stringify(
    {
      extends: '../../tsconfig.base.json',
      compilerOptions: {
        jsx: 'react-jsx',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        types: ['vite/client'],
        resolveJsonModule: true,
      },
      include: ['src/**/*', 'i18n/**/*'],
    },
    null,
    2,
  ) + '\n'

const viteConfig = () => `import { defineConfig, mergeConfig } from 'vite'
import base from '../../runtime/vite.config.base'

export default mergeConfig(
  base,
  defineConfig({
    // exercise-specific overrides here
  }),
)
`

const indexHtml = (title) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css"
    />
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      *, *::before, *::after { box-sizing: border-box; }
      :root { font-size: 1vh; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`

const mainTsx = (slug) => `import { defineExercise } from '@physics/sdk'
import Scene from './Scene'

const config = {
  id: '${slug}',
  version: '0.0.0',
  render: Scene,
}

if (import.meta.env.DEV) {
  const { withPreview } = await import('@physics/preview')
  withPreview(config)
} else {
  defineExercise(config)
}
`

const sceneTsx = () => `import { useEffect, useMemo, useState } from 'react'
import {
  useComplete,
  useCurrentStage,
  useDeclareStages,
  useInit,
  useNext,
  usePeek,
  useProgress,
  useReset,
  useSetStage,
} from '@physics/sdk/react'
import { getStagesFor } from './stages'

export default function Scene() {
  const { locale } = useInit()
  const stages = useMemo(() => getStagesFor(locale), [locale])
  useDeclareStages(stages)

  const stageIdx = useCurrentStage()
  const setStage = useSetStage()
  const [peekVisible, setPeekVisible] = useState(false)

  const complete = useComplete()
  const progress = useProgress()

  useEffect(() => {
    progress(stageIdx / stages.length, {
      stage: stageIdx,
      canSubmit: true,
    })
  }, [stageIdx, stages.length, progress])

  useReset(() => {
    setStage(1)
    setPeekVisible(false)
  })

  useNext(() => {
    if (stageIdx < stages.length) {
      setStage(stageIdx + 1)
    } else {
      complete({ success: true })
    }
  })

  usePeek(() => {
    setPeekVisible(true)
    setTimeout(() => setPeekVisible(false), 1500)
  })

  const current = stages[stageIdx - 1]

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#EAF0FA',
      fontFamily: '"Space Grotesk", system-ui, sans-serif',
      textAlign: 'center',
      padding: 32,
    }}>
      <div>
        <div style={{
          fontSize: 11,
          letterSpacing: '.15em',
          textTransform: 'uppercase',
          color: '#6C7A93',
          fontFamily: '"JetBrains Mono", monospace',
        }}>
          Stage {stageIdx} / {stages.length}
        </div>
        <h1 style={{
          fontSize: 48,
          fontWeight: 700,
          margin: '16px 0',
          letterSpacing: '-0.02em',
        }}>
          {current?.name ?? 'Complete'}
        </h1>
        <p style={{
          fontSize: 15,
          color: '#B9C4D6',
          maxWidth: 420,
          margin: '0 auto',
          lineHeight: 1.5,
        }}>
          Replace this scene with your exercise. The chrome's Next button advances stages;
          Reset returns to stage 1; Peek shows a placeholder overlay on stages that opted in.
        </p>
        {peekVisible && (
          <div style={{
            marginTop: 24,
            padding: '10px 16px',
            background: 'rgba(249,115,22,.15)',
            border: '1px solid #F97316',
            borderRadius: 8,
            color: '#F9A968',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12,
            display: 'inline-block',
          }}>
            👁 Peek shown for 1.5s
          </div>
        )}
      </div>
    </div>
  )
}
`

const stagesTs = () => `import type { StageInfo } from '@physics/sdk/react'
import en from '../i18n/en.json'
import fr from '../i18n/fr.json'
import ar from '../i18n/ar.json'

const dict = { en, fr, ar } as const

export function getStagesFor(locale: string): StageInfo[] {
  const key = locale in dict ? (locale as keyof typeof dict) : 'en'
  return dict[key].stages as StageInfo[]
}
`

const i18nJson = (data) => JSON.stringify(data, null, 2) + '\n'

// ─────────────────────────────────────────────────────────────────────────
// Localized starter content
// ─────────────────────────────────────────────────────────────────────────

const EN = {
  stages: [
    {
      index: 1,
      name: 'Observe',
      instruction:
        'Explore the scene freely and notice what changes as you interact. Advance when you feel you understand the relationship.',
      concept: 'Concept placeholder',
      peekable: false,
    },
    {
      index: 2,
      name: 'Experiment',
      instruction: 'Use what you observed to hit each target. Try different configurations.',
      concept: 'Concept placeholder',
      peekable: false,
    },
    {
      index: 3,
      name: 'Evaluate',
      instruction:
        'The visual aids are hidden. Reach the target using the concept alone. Peek is available if you need a moment.',
      concept: 'Concept placeholder',
      peekable: true,
    },
  ],
  hints: {
    '1': 'First hint — a small nudge in the right direction.',
    '2': 'Second hint — a more concrete pointer.',
    '3': 'Third hint — a near-solution reveal.',
  },
}

const FR = {
  stages: [
    {
      index: 1,
      name: 'Observer',
      instruction:
        'Explore la scène librement et remarque ce qui change quand tu interagis. Avance quand tu penses avoir compris la relation.',
      concept: 'Concept à définir',
      peekable: false,
    },
    {
      index: 2,
      name: 'Expérimenter',
      instruction: 'Utilise ce que tu as observé pour atteindre chaque cible. Essaie différentes configurations.',
      concept: 'Concept à définir',
      peekable: false,
    },
    {
      index: 3,
      name: 'Évaluer',
      instruction:
        'Les aides visuelles sont masquées. Atteins la cible en te fiant uniquement au concept. Peek est disponible si tu en as besoin.',
      concept: 'Concept à définir',
      peekable: true,
    },
  ],
  hints: {
    '1': 'Premier indice — un petit rappel.',
    '2': 'Deuxième indice — un pointeur plus concret.',
    '3': 'Troisième indice — presque la solution.',
  },
}

const AR = {
  stages: [
    {
      index: 1,
      name: 'لاحظ',
      instruction: 'استكشف المشهد بحرية ولاحظ ما يتغير أثناء التفاعل. تقدم عندما تشعر بفهم العلاقة.',
      concept: 'المفهوم',
      peekable: false,
    },
    {
      index: 2,
      name: 'جرب',
      instruction: 'استخدم ما لاحظته لإصابة كل هدف. جرب تكوينات مختلفة.',
      concept: 'المفهوم',
      peekable: false,
    },
    {
      index: 3,
      name: 'قيم',
      instruction: 'المساعدات البصرية مخفية. حقق الهدف بالاعتماد على المفهوم فقط. زر "نظرة سريعة" متاح عند الحاجة.',
      concept: 'المفهوم',
      peekable: true,
    },
  ],
  hints: {
    '1': 'التلميح الأول — دفعة صغيرة في الاتجاه الصحيح.',
    '2': 'التلميح الثاني — إشارة أكثر وضوحاً.',
    '3': 'التلميح الثالث — قريب من الحل.',
  },
}

main()
