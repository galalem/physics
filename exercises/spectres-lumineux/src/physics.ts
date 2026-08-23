// ─── Domain types ──────────────────────────────────────────────────────
export type ElementKey = 'H' | 'Na' | 'He'
export type SourceKey = 'continuum' | 'emission' | 'absorption'

export const ELEMENT_KEYS: readonly ElementKey[] = ['H', 'Na', 'He'] as const
export const SOURCE_KEYS: readonly SourceKey[] = [
  'continuum',
  'emission',
  'absorption',
] as const

// ─── Line data (nm) — visible-band emission/absorption lines per element ─
// Balmer series for H; principal visible lines for Na and He.
export const ELEMENTS: Record<
  ElementKey,
  { symbol: string; name: string; lines: number[] }
> = {
  H: {
    symbol: 'H',
    name: 'Hydrogen',
    // Balmer series: n = 3,4,5,6 → 2
    lines: [656.3, 486.1, 434.0, 410.2],
  },
  Na: {
    symbol: 'Na',
    name: 'Sodium',
    // D-doublet at 589.0 & 589.6, plus 615.4 and 568.3 secondaries
    lines: [589.0, 589.6, 615.4, 568.3, 498.3],
  },
  He: {
    symbol: 'He',
    name: 'Helium',
    // Principal visible neutral-helium lines
    lines: [667.8, 587.6, 501.6, 471.3, 447.1, 388.9],
  },
}

// ─── Setups (hand-authored, seed-indexed) ──────────────────────────────
// Each setup targets a distinct (source, element) pair so the student
// must both classify the source type and identify the element on stage 3.
export type Setup = { source: SourceKey; element: ElementKey }
export const SETUPS: Setup[] = [
  { source: 'emission', element: 'H' },
  { source: 'absorption', element: 'Na' },
  { source: 'emission', element: 'He' },
  { source: 'absorption', element: 'H' },
  { source: 'emission', element: 'Na' },
  { source: 'absorption', element: 'He' },
]

// ─── Feature match (discrete equality on both DOFs) ────────────────────
export function featureMatches(
  actual: { source: SourceKey; element: ElementKey },
  target: Setup,
): boolean {
  return actual.source === target.source && actual.element === target.element
}
