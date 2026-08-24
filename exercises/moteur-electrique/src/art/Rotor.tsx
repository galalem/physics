// Rotor — the rotating current-carrying bar (top-down view of the coil).
// { cx, cy } = pivot at the center of the motor.
// R = tip radius. angleRad = 0 → bar pointing right (aligned with +x, i.e. along B).
// The bar is drawn as a wide rounded rectangle plus a bright "arrow" tip that
// traces the target circle. Two small brush contacts sit at the pivot.

export function Rotor({
  cx,
  cy,
  R,
  angleRad,
  live,
}: {
  cx: number
  cy: number
  R: number
  angleRad: number
  live: boolean
}) {
  const rotDeg = (-angleRad * 180) / Math.PI // SVG y-down: invert
  const barLen = 2 * R
  const barW = 22
  const armColor = live ? '#F97316' : '#8FA4C6'
  const wireColor = live ? '#F9A968' : '#B9C4D6'
  return (
    <g transform={`translate(${cx} ${cy}) rotate(${rotDeg})`}>
      {/* Coil body — wide bar centered on pivot */}
      <rect
        x={-R}
        y={-barW / 2}
        width={barLen}
        height={barW}
        fill="#1A2340"
        stroke={armColor}
        strokeWidth={2}
        rx={4}
      />
      {/* Winding hint — 5 evenly-spaced vertical lines to suggest N turns */}
      {Array.from({ length: 6 }).map((_, i) => {
        const x = -R + 12 + i * ((barLen - 24) / 5)
        return (
          <line
            key={`w${i}`}
            x1={x}
            y1={-barW / 2 + 3}
            x2={x}
            y2={barW / 2 - 3}
            stroke={wireColor}
            strokeWidth={1.2}
            opacity={0.55}
          />
        )
      })}

      {/* Bright leading tip — traces the target circle */}
      <circle cx={R} cy={0} r={8} fill={armColor} opacity={0.28} />
      <circle cx={R} cy={0} r={4.5} fill={armColor} stroke="#0D1524" strokeWidth={1} />

      {/* Tail nub (the diametric opposite end) */}
      <circle cx={-R} cy={0} r={4} fill={wireColor} opacity={0.6} stroke="#0D1524" strokeWidth={0.8} />

      {/* Pivot + commutator (two small brushes at the pivot) */}
      <circle cx={0} cy={0} r={9} fill="#2A3244" stroke="#3A4863" strokeWidth={1.5} />
      <rect x={-8} y={-2} width={16} height={4} fill="#5A6479" rx={1} />
      <circle cx={0} cy={0} r={2} fill="#0D1524" />
    </g>
  )
}
