// Plates — two horizontal parallel deflection plates.
// (x1, x2) = left/right edges (SVG x). yTop / yBot = inner edge of each plate.
// polarity: sign of U. +1 → upper plate is + (marked +), lower is −. -1 flips.
// Plates get a faint field-line grid between them whose direction reflects polarity.

export function Plates({
  x1,
  x2,
  yTop,
  yBot,
  polarity,
  labelTop,
  labelBot,
}: {
  x1: number
  x2: number
  yTop: number
  yBot: number
  polarity: number
  labelTop: string
  labelBot: string
}) {
  const THICK = 8
  const width = x2 - x1
  const mid = (yTop + yBot) / 2
  // Field lines run vertically between the plates. When polarity > 0 (top +),
  // E points from + to −, i.e. downward → arrow tip at bottom.
  // When polarity < 0, arrows flip.
  const nLines = 6
  const gap = width / (nLines + 1)
  const lines: React.ReactNode[] = []
  const strength = Math.min(1, Math.abs(polarity))
  const opacity = 0.15 + 0.35 * strength
  for (let i = 1; i <= nLines; i++) {
    const lx = x1 + i * gap
    const y1 = polarity >= 0 ? yTop + 2 : yBot - 2
    const y2 = polarity >= 0 ? yBot - 2 : yTop + 2
    lines.push(
      <line
        key={`fl${i}`}
        x1={lx}
        y1={y1}
        x2={lx}
        y2={y2}
        stroke="#37C9B8"
        strokeWidth={1}
        strokeDasharray="2 3"
        opacity={opacity}
      />,
    )
    // Arrow head at the tip
    lines.push(
      <polygon
        key={`fh${i}`}
        points={`${lx - 3},${y2 + (polarity >= 0 ? -4 : 4)} ${lx + 3},${y2 + (polarity >= 0 ? -4 : 4)} ${lx},${y2}`}
        fill="#37C9B8"
        opacity={opacity}
      />,
    )
  }
  return (
    <g>
      {/* Upper plate */}
      <rect
        x={x1}
        y={yTop - THICK}
        width={width}
        height={THICK}
        fill="#5A6479"
        stroke="#0D1524"
        strokeWidth={1}
        rx={1}
      />
      {/* Lower plate */}
      <rect
        x={x1}
        y={yBot}
        width={width}
        height={THICK}
        fill="#5A6479"
        stroke="#0D1524"
        strokeWidth={1}
        rx={1}
      />
      {/* Field lines */}
      {lines}
      {/* Polarity labels */}
      <text
        x={x1 - 6}
        y={yTop - THICK / 2 + 3}
        fill={polarity >= 0 ? '#F97316' : '#37C9B8'}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="end"
      >
        {polarity >= 0 ? '+' : '−'} {labelTop}
      </text>
      <text
        x={x1 - 6}
        y={yBot + THICK / 2 + 4}
        fill={polarity >= 0 ? '#37C9B8' : '#F97316'}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="end"
      >
        {polarity >= 0 ? '−' : '+'} {labelBot}
      </text>
      {/* Midline reference (very faint) */}
      <line x1={x1} y1={mid} x2={x2} y2={mid} stroke="#12203a" strokeWidth={0.5} strokeDasharray="1 4" />
    </g>
  )
}
