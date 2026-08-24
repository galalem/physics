// Particle — the moving positive charge.
// { x, y } = SVG position (screen coords).
// Optional `showF` overlays the Lorentz force arrow F = q v ∧ B, pointing
// FROM the particle TOWARD the centre of the circular arc (perpendicular
// to v, to the right of v for q > 0 with B out of page). `fxu`/`fyu` is a
// unit vector giving the direction of F in SVG space.

export function Particle({
  x,
  y,
  showF = false,
  fxu = 0,
  fyu = 0,
}: {
  x: number
  y: number
  showF?: boolean
  fxu?: number
  fyu?: number
}) {
  const F_LEN = 26
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Soft glow */}
      <circle cx={0} cy={0} r={10} fill="#F97316" opacity={0.25} />
      {/* Body */}
      <circle cx={0} cy={0} r={5} fill="#1A1F2E" stroke="#F97316" strokeWidth={1.5} />
      {/* Highlight */}
      <circle cx={-1.3} cy={-1.3} r={1.4} fill="#F9A968" opacity={0.85} />

      {/* F arrow (stage 1 only) — always perpendicular to v, pointing to
          the centre of the circle. */}
      {showF && (fxu !== 0 || fyu !== 0) && (
        <g>
          <line
            x1={0}
            y1={0}
            x2={fxu * F_LEN}
            y2={fyu * F_LEN}
            stroke="#F97316"
            strokeWidth={1.8}
            opacity={0.9}
          />
          {/* Arrowhead */}
          <polygon
            points={`${fxu * F_LEN},${fyu * F_LEN} ${fxu * (F_LEN - 5) - fyu * 3},${fyu * (F_LEN - 5) + fxu * 3} ${fxu * (F_LEN - 5) + fyu * 3},${fyu * (F_LEN - 5) - fxu * 3}`}
            fill="#F97316"
            opacity={0.9}
          />
          <text
            x={fxu * (F_LEN + 8)}
            y={fyu * (F_LEN + 8) + 3}
            fill="#F97316"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
            style={{ userSelect: 'none' }}
          >
            F
          </text>
        </g>
      )}
    </g>
  )
}
