import type { SceneAllow, SceneSnapshot } from './components/TutorialScene'

/**
 * The guided-tour script — structure only.
 *
 * `title` / `body` / `cta` / `waiting` hold i18n KEYS, not prose; the copy
 * lives in `src/lang/{en,fr,ar}.json` under `pages.tutorial.tour.<id>.*`.
 * Bodies may carry `$...$` (KaTeX, via MathText) and `**bold**`.
 *
 * The stage-3 numbers below are REAL, and only stay real because the
 * tutorial pins target setup 0: S(100,350), M(400,200), T(700,350) in the
 * Cartesian frame the scene labels. That setup is symmetric — S and T sit
 * at the same height — so the answer is a level mirror, φ = 0°. If the
 * pinned setup ever changes, these numbers must be recomputed.
 */

export type TourStep = {
  id: string
  /** Stage this step belongs to. The tour drives the stage forward. */
  stage: 1 | 2 | 3
  /**
   * Chapter this step belongs to. The overlay only ever shows progress
   * WITHIN a chapter — "3 / 8" reads as a short errand, "3 / 31" reads as
   * a chore and makes students bail before they start.
   */
  chapter: 0 | 1 | 2 | 3
  /** `data-tour` value, or a CSS selector when it starts with . # or [ */
  anchor?: string
  title?: string
  body: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto'
  padding?: number
  /** What the student may touch during this step. Defaults to nothing. */
  allow?: SceneAllow
  /** `'click'` = advance on the button; a predicate = advance on a real action. */
  advance: 'click' | ((s: SceneSnapshot) => boolean)
  cta?: string
  waiting?: string
  /** False lets clicks through the dimmed area (rarely needed). */
  blockOutside?: boolean
}

export const CHAPTERS = [
  { id: 'ui', title: 'pages.tutorial.chapter.ui' },
  { id: 'observe', title: 'pages.tutorial.chapter.observe' },
  { id: 'experiment', title: 'pages.tutorial.chapter.experiment' },
  { id: 'evaluate', title: 'pages.tutorial.chapter.evaluate' },
] as const

const NONE: SceneAllow = { drag: false, fire: false }
const DRAG: SceneAllow = { drag: true, fire: false }
const BOTH: SceneAllow = { drag: true, fire: true }

export const TOUR: TourStep[] = [
  // ─── Orientation ──────────────────────────────────────────────────────
  {
    id: 'welcome',
    chapter: 0,
    stage: 1,
    title: 'pages.tutorial.tour.welcome.title',
    body: 'pages.tutorial.tour.welcome.body',
    advance: 'click',
    cta: 'pages.tutorial.tour.welcome.cta',
  },
  {
    id: 'canvas',
    chapter: 0,
    stage: 1,
    anchor: '.canvas',
    title: 'pages.tutorial.tour.canvas.title',
    body: 'pages.tutorial.tour.canvas.body',
    placement: 'left',
    advance: 'click',
  },
  {
    id: 'rail',
    chapter: 0,
    stage: 1,
    anchor: '.stage-rail',
    title: 'pages.tutorial.tour.rail.title',
    body: 'pages.tutorial.tour.rail.body',
    placement: 'right',
    advance: 'click',
  },
  {
    id: 'instruction',
    chapter: 0,
    stage: 1,
    anchor: '.instruction',
    title: 'pages.tutorial.tour.instruction.title',
    body: 'pages.tutorial.tour.instruction.body',
    placement: 'right',
    advance: 'click',
  },
  {
    id: 'concept',
    chapter: 0,
    stage: 1,
    anchor: '.concept',
    title: 'pages.tutorial.tour.concept.title',
    body: 'pages.tutorial.tour.concept.body',
    placement: 'right',
    advance: 'click',
  },
  {
    id: 'hud-tl',
    chapter: 0,
    stage: 1,
    anchor: 'hud-tl',
    title: 'pages.tutorial.tour.hud-tl.title',
    body: 'pages.tutorial.tour.hud-tl.body',
    placement: 'bottom',
    advance: 'click',
  },
  {
    id: 'hud-tr',
    chapter: 0,
    stage: 1,
    anchor: 'hud-tr',
    title: 'pages.tutorial.tour.hud-tr.title',
    body: 'pages.tutorial.tour.hud-tr.body',
    placement: 'bottom',
    advance: 'click',
  },
  {
    id: 'fullscreen',
    chapter: 0,
    stage: 1,
    anchor: 'fullscreen',
    title: 'pages.tutorial.tour.fullscreen.title',
    body: 'pages.tutorial.tour.fullscreen.body',
    placement: 'top',
    advance: 'click',
  },
  {
    id: 'controls',
    chapter: 0,
    stage: 1,
    anchor: '.controls',
    title: 'pages.tutorial.tour.controls.title',
    body: 'pages.tutorial.tour.controls.body',
    placement: 'right',
    advance: 'click',
  },

  // ─── Stage 1 — Observe ────────────────────────────────────────────────
  {
    id: 'source',
    chapter: 1,
    stage: 1,
    anchor: 'source',
    title: 'pages.tutorial.tour.source.title',
    body: 'pages.tutorial.tour.source.body',
    advance: 'click',
  },
  {
    id: 'mirror-intro',
    chapter: 1,
    stage: 1,
    anchor: 'mirror',
    title: 'pages.tutorial.tour.mirror-intro.title',
    body: 'pages.tutorial.tour.mirror-intro.body',
    advance: 'click',
  },
  {
    id: 'mirror-drag',
    chapter: 1,
    stage: 1,
    anchor: '.canvas',
    title: 'pages.tutorial.tour.mirror-drag.title',
    body: 'pages.tutorial.tour.mirror-drag.body',
    placement: 'left',
    allow: DRAG,
    advance: (s) => s.moved,
    waiting: 'pages.tutorial.tour.mirror-drag.waiting',
  },
  {
    id: 'normal',
    chapter: 1,
    stage: 1,
    anchor: 'normal',
    title: 'pages.tutorial.tour.normal.title',
    body: 'pages.tutorial.tour.normal.body',
    advance: 'click',
  },
  {
    id: 'arcs',
    chapter: 1,
    stage: 1,
    anchor: '.canvas',
    title: 'pages.tutorial.tour.arcs.title',
    body: 'pages.tutorial.tour.arcs.body',
    placement: 'left',
    allow: DRAG,
    advance: 'click',
  },
  {
    id: 'stage1-done',
    chapter: 1,
    stage: 1,
    anchor: '.controls',
    title: 'pages.tutorial.tour.stage1-done.title',
    body: 'pages.tutorial.tour.stage1-done.body',
    placement: 'right',
    allow: DRAG,
    advance: (s) => s.stage >= 2,
    waiting: 'pages.tutorial.tour.stage1-done.waiting',
  },

  // ─── Stage 2 — Experiment ─────────────────────────────────────────────
  {
    id: 'stage2-intro',
    chapter: 2,
    stage: 2,
    title: 'pages.tutorial.tour.stage2-intro.title',
    body: 'pages.tutorial.tour.stage2-intro.body',
    advance: 'click',
  },
  {
    id: 'stars',
    chapter: 2,
    stage: 2,
    anchor: 'stars',
    title: 'pages.tutorial.tour.stars.title',
    body: 'pages.tutorial.tour.stars.body',
    advance: 'click',
  },
  {
    id: 'fire-intro',
    chapter: 2,
    stage: 2,
    anchor: 'fire',
    title: 'pages.tutorial.tour.fire-intro.title',
    body: 'pages.tutorial.tour.fire-intro.body',
    placement: 'top',
    advance: 'click',
  },
  {
    id: 'shots',
    chapter: 2,
    stage: 2,
    anchor: 'hud-br',
    title: 'pages.tutorial.tour.shots.title',
    body: 'pages.tutorial.tour.shots.body',
    placement: 'top',
    advance: 'click',
  },
  {
    id: 'stage2-play',
    chapter: 2,
    stage: 2,
    anchor: '.canvas',
    title: 'pages.tutorial.tour.stage2-play.title',
    body: 'pages.tutorial.tour.stage2-play.body',
    placement: 'left',
    allow: BOTH,
    advance: (s) => s.lit.length >= 3,
    waiting: 'pages.tutorial.tour.stage2-play.waiting',
  },
  {
    id: 'stage2-done',
    chapter: 2,
    stage: 2,
    anchor: '.controls',
    title: 'pages.tutorial.tour.stage2-done.title',
    body: 'pages.tutorial.tour.stage2-done.body',
    placement: 'right',
    allow: BOTH,
    advance: (s) => s.stage >= 3,
    waiting: 'pages.tutorial.tour.stage2-done.waiting',
  },

  // ─── Stage 3 — Evaluate ───────────────────────────────────────────────
  {
    id: 'stage3-warning',
    chapter: 3,
    stage: 3,
    title: 'pages.tutorial.tour.stage3-warning.title',
    body: 'pages.tutorial.tour.stage3-warning.body',
    advance: 'click',
    cta: 'pages.tutorial.tour.stage3-warning.cta',
  },
  {
    id: 'get-paper',
    chapter: 3,
    stage: 3,
    title: 'pages.tutorial.tour.get-paper.title',
    body: 'pages.tutorial.tour.get-paper.body',
    advance: 'click',
    cta: 'pages.tutorial.tour.get-paper.cta',
  },
  {
    id: 'coords',
    chapter: 3,
    stage: 3,
    anchor: '.canvas',
    title: 'pages.tutorial.tour.coords.title',
    body: 'pages.tutorial.tour.coords.body',
    placement: 'left',
    advance: 'click',
  },
  {
    id: 'calc-1',
    chapter: 3,
    stage: 3,
    anchor: '.concept',
    title: 'pages.tutorial.tour.calc-1.title',
    body: 'pages.tutorial.tour.calc-1.body',
    placement: 'right',
    advance: 'click',
  },
  {
    id: 'calc-2',
    chapter: 3,
    stage: 3,
    title: 'pages.tutorial.tour.calc-2.title',
    body: 'pages.tutorial.tour.calc-2.body',
    advance: 'click',
  },
  {
    id: 'calc-3',
    chapter: 3,
    stage: 3,
    title: 'pages.tutorial.tour.calc-3.title',
    body: 'pages.tutorial.tour.calc-3.body',
    advance: 'click',
  },
  {
    id: 'calc-check',
    chapter: 3,
    stage: 3,
    title: 'pages.tutorial.tour.calc-check.title',
    body: 'pages.tutorial.tour.calc-check.body',
    advance: 'click',
  },
  {
    id: 'set-mirror',
    chapter: 3,
    stage: 3,
    anchor: '.canvas',
    title: 'pages.tutorial.tour.set-mirror.title',
    body: 'pages.tutorial.tour.set-mirror.body',
    placement: 'left',
    allow: DRAG,
    // Peek lives in the controls, outside the spotlight — let clicks through.
    blockOutside: false,
    advance: (s) => Math.abs(s.phiDeg) < 2.5,
    waiting: 'pages.tutorial.tour.set-mirror.waiting',
  },
  {
    id: 'fire-final',
    chapter: 3,
    stage: 3,
    anchor: '.canvas',
    title: 'pages.tutorial.tour.fire-final.title',
    body: 'pages.tutorial.tour.fire-final.body',
    placement: 'left',
    allow: BOTH,
    advance: (s) => s.targetIdx >= 1 || s.lit.length >= 1,
    waiting: 'pages.tutorial.tour.fire-final.waiting',
  },
  {
    id: 'second-target',
    chapter: 3,
    stage: 3,
    anchor: '.canvas',
    title: 'pages.tutorial.tour.second-target.title',
    body: 'pages.tutorial.tour.second-target.body',
    placement: 'left',
    allow: BOTH,
    advance: (s) => s.canSubmit,
    waiting: 'pages.tutorial.tour.second-target.waiting',
  },
  {
    id: 'finish',
    chapter: 3,
    stage: 3,
    title: 'pages.tutorial.tour.finish.title',
    body: 'pages.tutorial.tour.finish.body',
    advance: 'click',
    cta: 'pages.tutorial.tour.finish.cta',
  },
]

export const stepAllow = (s: TourStep): SceneAllow => s.allow ?? NONE

/** Where a global step index sits inside its own chapter. */
export function chapterProgress(index: number) {
  const step = TOUR[index]!
  const siblings = TOUR.filter((t) => t.chapter === step.chapter)
  const posInChapter = siblings.findIndex((t) => t.id === step.id)
  return {
    chapter: step.chapter,
    title: CHAPTERS[step.chapter]!.title,
    position: posInChapter + 1,
    length: siblings.length,
  }
}
