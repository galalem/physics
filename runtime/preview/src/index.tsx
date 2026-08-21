/**
 * @physics/preview — standalone-exercise dev harness.
 *
 * Usage (in the exercise's main.tsx):
 *
 *   import { defineExercise } from '@physics/sdk'
 *   import Scene from './Scene'
 *
 *   const config = { id: 'reflexion-lumiere', version: '1.0.0', render: Scene }
 *
 *   if (import.meta.env.DEV) {
 *     const { withPreview } = await import('@physics/preview')
 *     withPreview(config)
 *   } else {
 *     defineExercise(config)
 *   }
 *
 * Vite tree-shakes the DEV branch in prod builds. No preview code ships.
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { defineExercise, type ExerciseConfig } from '@physics/sdk'
import { FakeHost, type PreviewInitConfig } from './fake-host.js'
import { Chrome, DebugPanel } from './chrome.js'

export type PreviewOptions = PreviewInitConfig

export function withPreview(config: ExerciseConfig, options: PreviewOptions = {}): void {
  // 1. Prepare the DOM layout — three regions: chrome left rail,
  //    canvas area (contains #root where the exercise mounts), debug bar.
  ensureFonts()
  ensureLayout()

  // 2. Create the fake host BEFORE defineExercise so we don't miss READY.
  const host = new FakeHost(options)

  // 3. Render the chrome + debug panel.
  const chromeRoot = document.getElementById('preview-chrome-mount')
  const debugRoot = document.getElementById('preview-debug-mount')
  if (chromeRoot) createRoot(chromeRoot).render(createElement(Chrome, { host }))
  if (debugRoot) createRoot(debugRoot).render(createElement(DebugPanel, { host }))

  // 4. Bootstrap the exercise. It renders into #root (created by ensureLayout).
  defineExercise(config)
}

/**
 * Sets up the standalone dev DOM:
 *   #preview-app
 *     #preview-chrome-mount   (React portal for Chrome)
 *     #preview-canvas         (navy card containing #root)
 *       #root                 (exercise's React tree mounts here)
 *   #preview-debug-mount      (React portal for DebugPanel)
 */
function ensureLayout(): void {
  if (document.getElementById('preview-app')) return

  const styleEl = document.createElement('style')
  styleEl.textContent = LAYOUT_CSS
  document.head.appendChild(styleEl)

  const app = document.createElement('div')
  app.id = 'preview-app'

  const chromeMount = document.createElement('aside')
  chromeMount.id = 'preview-chrome-mount'

  const canvasArea = document.createElement('main')
  canvasArea.id = 'preview-canvas'

  // The exercise's #root goes inside the canvas area so completion overlays
  // can be absolutely positioned over it.
  // Reuse the exercise's own #root (from index.html) if present — otherwise
  // when defineExercise calls document.getElementById('root') it would find
  // the original one at body level (outside our layout) and mount there,
  // making the scene invisible.
  let root = document.getElementById('root')
  if (root) {
    root.remove()
  } else {
    root = document.createElement('div')
    root.id = 'root'
  }
  canvasArea.appendChild(root)

  app.appendChild(chromeMount)
  app.appendChild(canvasArea)
  document.body.appendChild(app)

  const debugMount = document.createElement('div')
  debugMount.id = 'preview-debug-mount'
  document.body.appendChild(debugMount)
}

function ensureFonts(): void {
  if (document.querySelector('link[data-preview-fonts]')) return
  const preconnect1 = document.createElement('link')
  preconnect1.rel = 'preconnect'
  preconnect1.href = 'https://fonts.googleapis.com'
  const preconnect2 = document.createElement('link')
  preconnect2.rel = 'preconnect'
  preconnect2.href = 'https://fonts.gstatic.com'
  preconnect2.crossOrigin = 'anonymous'
  const fonts = document.createElement('link')
  fonts.rel = 'stylesheet'
  fonts.href =
    'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap'
  fonts.setAttribute('data-preview-fonts', 'true')
  document.head.appendChild(preconnect1)
  document.head.appendChild(preconnect2)
  document.head.appendChild(fonts)
}

const LAYOUT_CSS = `
  html, body { margin: 0; padding: 0; height: 100%; background: #EFEDE7; }
  body { overflow: hidden; }
  #preview-app {
    display: grid;
    grid-template-areas: "rail canvas";
    grid-template-columns: 340px 1fr;
    height: calc(100vh - 40px);
  }
  #preview-chrome-mount { grid-area: rail; }
  #preview-canvas {
    grid-area: canvas;
    background: #0D1524;
    border-radius: 16px;
    margin: 16px 16px 16px 0;
    box-shadow: 0 28px 60px -30px rgba(13,21,36,.6);
    position: relative;
    overflow: hidden;
  }
  #root { width: 100%; height: 100%; }
  #preview-debug-mount { position: relative; }
`
