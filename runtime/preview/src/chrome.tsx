/**
 * Chrome + DebugPanel React components rendered around the exercise
 * during standalone dev.
 *
 * Approximates the LMS design's exercise page (stage rail, instruction
 * zone, canvas card, controls) plus a bottom debug panel that doesn't
 * exist in production (seed input, state inspector, hint triggers, etc.).
 *
 * Styling is inline — approximating the design tokens (cream / navy /
 * orange, Space Grotesk / JetBrains Mono) but not pixel-perfect.
 */

import { useSyncExternalStore, useState, useEffect, type CSSProperties } from 'react'
import type { FakeHost } from './fake-host.js'

// Design tokens (approximate — see design/design_handoff_physics_app/README.md)
const T = {
  cream: '#EFEDE7',
  cardCream: '#FAF9F5',
  cardCream2: '#F3F1EA',
  ink: '#16151C',
  muted: '#54514A',
  faint: '#8A8779',
  border: '#E2DFD4',
  borderStrong: '#D8D4C8',
  orange: '#F97316',
  orangeHover: '#e2660d',
  orangeSoft: '#F9A968',
  navy: '#0D1524',
  navyDeep: '#0A1120',
  navyText: '#EAF0FA',
  navyMuted: '#B9C4D6',
  navyBorder: '#1E2A40',
  teal: '#1FA595',
  tealSoft: '#E9F6F4',
  radiusCard: '16px',
  radiusButton: '999px',
  fontUi: '"Space Grotesk", system-ui, -apple-system, sans-serif',
  fontMono: '"JetBrains Mono", "Fira Code", "Menlo", monospace',
} as const

// ─────────────────────────────────────────────────────────────────────────
// Root — sits above the exercise scene and around it
// ─────────────────────────────────────────────────────────────────────────

export function Chrome({ host }: { host: FakeHost }): JSX.Element {
  const s = useSyncExternalStore(
    (cb) => host.subscribe(cb),
    () => host.getSnapshot(),
    () => host.getSnapshot(),
  )

  const stage = s.stages.find((st) => st.index === s.currentStage)
  const isLastStage = s.stages.length > 0 && s.currentStage === s.stages.length

  return (
    <>
      <LeftRail
        host={host}
        stages={s.stages}
        currentStage={s.currentStage}
        stageInfo={stage}
        readout={s.readout}
        canSubmit={s.canSubmit}
        isLastStage={isLastStage}
        paused={s.paused}
      />
      {s.completed && (
        <CompletionOverlay
          result={s.completed}
          onRetry={() => host.resetWithNewSeed()}
        />
      )}
      {s.errored && <ErrorBanner code={s.errored.code} message={s.errored.message} />}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Left rail — mirrors LMS design's exercise-page left column
// ─────────────────────────────────────────────────────────────────────────

type LeftRailProps = {
  host: FakeHost
  stages: readonly import('@physics/protocol').StageInfo[]
  currentStage: number
  stageInfo: import('@physics/protocol').StageInfo | undefined
  readout: string | null
  canSubmit: boolean
  isLastStage: boolean
  paused: boolean
}

function LeftRail({
  host, stages, currentStage, stageInfo, readout, canSubmit, isLastStage, paused,
}: LeftRailProps): JSX.Element {
  const showPeek = stageInfo?.peekable ?? false

  return (
    <aside style={styles.leftRail}>
      <StageRail total={stages.length || 3} current={currentStage} />

      {stageInfo && (
        <>
          <div style={styles.stageLabel}>Stage {currentStage}</div>
          <h2 style={styles.stageTitle}>{stageInfo.name}</h2>
          <p style={styles.instruction}>{stageInfo.instruction}</p>
          {stageInfo.concept && (
            <div style={styles.conceptCallout}>
              <div style={styles.conceptLabel}>Concept</div>
              <div style={styles.conceptText}>{stageInfo.concept}</div>
            </div>
          )}
        </>
      )}

      {readout && (
        <div style={styles.readoutBox}>
          <div style={styles.readoutLabel}>Readout</div>
          <div style={styles.readoutValue}>{readout}</div>
        </div>
      )}

      <div style={styles.controlsGroup}>
        <button style={styles.outlineButton} onClick={() => host.resetWithNewSeed()}>
          ↻ Reset
        </button>
        {showPeek && (
          <button style={styles.outlineButton} onClick={() => host.peek()}>
            Peek
          </button>
        )}
        <button
          style={{ ...styles.primaryButton, opacity: canSubmit ? 1 : 0.4 }}
          onClick={() => host.next()}
          disabled={!canSubmit}
        >
          {isLastStage ? 'Finish' : 'Next'}
        </button>
        <button style={styles.textButton} onClick={() => (paused ? host.resume() : host.pause())}>
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
      </div>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Stage rail — N segments, current highlighted
// ─────────────────────────────────────────────────────────────────────────

function StageRail({ total, current }: { total: number; current: number }): JSX.Element {
  return (
    <div style={styles.stageRail}>
      {Array.from({ length: total }).map((_, i) => {
        const idx = i + 1
        const filled = idx <= current
        return (
          <div
            key={idx}
            style={{
              ...styles.stageSegment,
              background: filled ? T.orange : T.borderStrong,
            }}
          />
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Completion overlay — over the canvas area
// ─────────────────────────────────────────────────────────────────────────

function CompletionOverlay({
  result,
  onRetry,
}: {
  result: import('@physics/protocol').CompletePayload
  onRetry: () => void
}): JSX.Element {
  return (
    <div style={styles.overlay}>
      <div style={styles.overlayCard}>
        <div style={{ ...styles.stageLabel, color: result.success ? T.teal : T.orangeSoft }}>
          {result.success ? 'Complete' : 'Attempt ended'}
        </div>
        <h2 style={{ ...styles.stageTitle, color: T.navyText, marginTop: 8 }}>
          {result.success ? '✓ Success' : '✗ Not quite'}
        </h2>
        {result.score !== undefined && (
          <div style={{ color: T.navyMuted, fontFamily: T.fontMono, marginTop: 12 }}>
            Score: {result.score}
          </div>
        )}
        <div style={{ color: T.navyMuted, fontFamily: T.fontMono, marginTop: 4 }}>
          Time: {(result.timeMs / 1000).toFixed(1)}s
        </div>
        <button style={{ ...styles.primaryButton, marginTop: 24 }} onClick={onRetry}>
          ↻ Retry (new seed)
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Error banner
// ─────────────────────────────────────────────────────────────────────────

function ErrorBanner({ code, message }: { code: string; message: string }): JSX.Element {
  return (
    <div style={styles.errorBanner}>
      <strong style={{ fontFamily: T.fontMono }}>{code}</strong>: {message}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// DebugPanel — dev-only bottom bar (not in production)
// ─────────────────────────────────────────────────────────────────────────

export function DebugPanel({ host }: { host: FakeHost }): JSX.Element {
  const s = useSyncExternalStore(
    (cb) => host.subscribe(cb),
    () => host.getSnapshot(),
    () => host.getSnapshot(),
  )

  const [collapsed, setCollapsed] = useState(false)
  const [seedInput, setSeedInput] = useState(String(s.seed))

  useEffect(() => {
    setSeedInput(String(s.seed))
  }, [s.seed])

  if (collapsed) {
    return (
      <div style={styles.debugCollapsed}>
        <button style={styles.debugToggle} onClick={() => setCollapsed(false)}>
          ▲ Show debug
        </button>
      </div>
    )
  }

  return (
    <div style={styles.debugPanel}>
      <div style={styles.debugHeader}>
        <span style={styles.debugHeading}>Preview · debug</span>
        <button style={styles.debugToggle} onClick={() => setCollapsed(true)}>
          ▼ Hide
        </button>
      </div>

      <div style={styles.debugGrid}>
        <DebugCell label="Seed">
          <input
            style={styles.debugInput}
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            onBlur={() => {
              const n = Number(seedInput)
              if (Number.isFinite(n)) host.setSeed(n)
            }}
          />
        </DebugCell>

        <DebugCell label="Locale">
          <span style={styles.debugMono}>{s.locale}</span>
        </DebugCell>

        <DebugCell label="Ready / Init">
          <span style={styles.debugMono}>
            {s.ready ? '✓' : '·'} / {s.initialized ? '✓' : '·'}
          </span>
        </DebugCell>

        <DebugCell label="Progress">
          <span style={styles.debugMono}>{s.progress.toFixed(2)}</span>
        </DebugCell>

        <DebugCell label="Stage">
          <span style={styles.debugMono}>
            {s.currentStage} / {s.stages.length || '?'}
          </span>
        </DebugCell>

        <DebugCell label="canSubmit">
          <span style={styles.debugMono}>{s.canSubmit ? 'true' : 'false'}</span>
        </DebugCell>

        <DebugCell label="Hints">
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 2, 3].map((lvl) => (
              <button key={lvl} style={styles.debugSmallButton} onClick={() => host.requestHint(lvl)}>
                L{lvl}
              </button>
            ))}
            <button style={styles.debugSmallButton} onClick={() => host.requestState()}>
              Req state
            </button>
          </div>
        </DebugCell>

        <DebugCell label="Hints left">
          <span style={styles.debugMono}>{s.hintsRemaining ?? '—'}</span>
        </DebugCell>
      </div>

      {s.lastHint && (
        <div style={styles.debugSection}>
          <div style={styles.debugSubheading}>Last hint</div>
          <div style={{ ...styles.debugMono, whiteSpace: 'pre-wrap' }}>{s.lastHint.text}</div>
        </div>
      )}

      <div style={styles.debugSection}>
        <div style={styles.debugSubheading}>Last checkpoint</div>
        <pre style={styles.debugPre}>
          {s.lastCheckpoint ? formatJson(s.lastCheckpoint) : '(none)'}
        </pre>
      </div>
    </div>
  )
}

function DebugCell({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={styles.debugCell}>
      <div style={styles.debugCellLabel}>{label}</div>
      <div>{children}</div>
    </div>
  )
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  leftRail: {
    gridArea: 'rail',
    background: T.cream,
    padding: '24px',
    overflowY: 'auto',
    fontFamily: T.fontUi,
    color: T.ink,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  stageRail: {
    display: 'flex',
    gap: 6,
    marginBottom: 8,
  },
  stageSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    transition: 'background 200ms',
  },
  stageLabel: {
    fontFamily: T.fontMono,
    fontSize: 11,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    color: T.faint,
  },
  stageTitle: {
    fontFamily: T.fontUi,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: '-.02em',
    margin: 0,
    lineHeight: 1.1,
  },
  instruction: {
    fontFamily: T.fontUi,
    fontSize: 14,
    lineHeight: 1.5,
    color: T.muted,
    margin: 0,
  },
  conceptCallout: {
    background: T.tealSoft,
    border: `1px solid #BEE3DE`,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  conceptLabel: {
    fontFamily: T.fontMono,
    fontSize: 10,
    letterSpacing: '.15em',
    textTransform: 'uppercase',
    color: T.teal,
    marginBottom: 4,
  },
  conceptText: {
    fontFamily: T.fontMono,
    fontSize: 13,
    color: T.ink,
  },
  readoutBox: {
    background: T.cardCream2,
    border: `1px solid ${T.border}`,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  readoutLabel: {
    fontFamily: T.fontMono,
    fontSize: 10,
    letterSpacing: '.15em',
    textTransform: 'uppercase',
    color: T.faint,
    marginBottom: 4,
  },
  readoutValue: {
    fontFamily: T.fontMono,
    fontSize: 14,
    color: T.ink,
  },
  controlsGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 'auto',
    paddingTop: 16,
  },
  primaryButton: {
    background: T.orange,
    color: 'white',
    border: 'none',
    borderRadius: T.radiusButton,
    padding: '10px 20px',
    fontFamily: T.fontUi,
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  outlineButton: {
    background: 'transparent',
    color: T.ink,
    border: `1px solid ${T.borderStrong}`,
    borderRadius: T.radiusButton,
    padding: '10px 20px',
    fontFamily: T.fontUi,
    fontSize: 14,
    cursor: 'pointer',
  },
  textButton: {
    background: 'transparent',
    color: T.muted,
    border: 'none',
    padding: 6,
    fontFamily: T.fontUi,
    fontSize: 12,
    cursor: 'pointer',
    textAlign: 'left',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(13,21,36,.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    pointerEvents: 'none',
  },
  overlayCard: {
    background: T.navyDeep,
    padding: '32px 40px',
    borderRadius: T.radiusCard,
    border: `1px solid ${T.navyBorder}`,
    textAlign: 'center',
    pointerEvents: 'auto',
  },
  errorBanner: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    padding: '10px 14px',
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: 8,
    fontFamily: T.fontUi,
    fontSize: 13,
    zIndex: 11,
  },
  debugCollapsed: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: T.ink,
    color: T.cream,
    padding: '4px 8px',
    display: 'flex',
    justifyContent: 'flex-end',
    fontFamily: T.fontMono,
    fontSize: 11,
    zIndex: 100,
  },
  debugPanel: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '35vh',
    overflowY: 'auto',
    background: T.ink,
    color: T.cream,
    borderTop: `2px solid ${T.orange}`,
    padding: '10px 14px',
    fontFamily: T.fontMono,
    fontSize: 12,
    zIndex: 100,
  },
  debugHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  debugHeading: {
    fontFamily: T.fontMono,
    fontSize: 11,
    letterSpacing: '.15em',
    textTransform: 'uppercase',
    color: T.orangeSoft,
  },
  debugToggle: {
    background: 'transparent',
    color: T.cream,
    border: `1px solid ${T.navyMuted}`,
    borderRadius: 4,
    padding: '2px 8px',
    fontFamily: T.fontMono,
    fontSize: 10,
    cursor: 'pointer',
  },
  debugGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10,
    marginBottom: 8,
  },
  debugCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  debugCellLabel: {
    fontFamily: T.fontMono,
    fontSize: 9,
    letterSpacing: '.15em',
    textTransform: 'uppercase',
    color: T.navyMuted,
  },
  debugMono: {
    fontFamily: T.fontMono,
    fontSize: 12,
    color: T.cream,
  },
  debugInput: {
    background: T.navyDeep,
    color: T.cream,
    border: `1px solid ${T.navyBorder}`,
    borderRadius: 4,
    padding: '3px 6px',
    fontFamily: T.fontMono,
    fontSize: 12,
    width: 100,
  },
  debugSmallButton: {
    background: T.navyDeep,
    color: T.cream,
    border: `1px solid ${T.navyBorder}`,
    borderRadius: 4,
    padding: '2px 6px',
    fontFamily: T.fontMono,
    fontSize: 10,
    cursor: 'pointer',
  },
  debugSection: {
    marginTop: 6,
    paddingTop: 6,
    borderTop: `1px solid ${T.navyBorder}`,
  },
  debugSubheading: {
    fontFamily: T.fontMono,
    fontSize: 9,
    letterSpacing: '.15em',
    textTransform: 'uppercase',
    color: T.navyMuted,
    marginBottom: 3,
  },
  debugPre: {
    fontFamily: T.fontMono,
    fontSize: 11,
    color: T.cream,
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    maxHeight: 100,
    overflowY: 'auto',
  },
}
