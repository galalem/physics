// Emitter — small "particle gun" that shoots a charged particle in the
// direction of v. { x, y } = pivot (muzzle base). angleRad in world y-up
// convention (0 = right, +π/2 = up on screen). The gun body is drawn
// static; a slim barrel rotates and a chevron marks the v-direction.
//
// To swap in more detailed art later: keep the props signature.

export function Emitter({ x, y, angleRad }: { x: number; y: number; angleRad: number }) {
  const rotDeg = (-angleRad * 180) / Math.PI // negate: SVG y-down
  const BARREL_LEN = 34
  const BARREL_HALF = 4
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Base plate */}
      <rect x={-14} y={-3} width={28} height={16} fill="#1E2A40" stroke="#3A4863" strokeWidth={1.2} rx={2} />
      {/* Rear housing (holds "charge reservoir") */}
      <rect x={-11} y={-9} width={12} height={10} fill="#2A3244" stroke="#3A4863" strokeWidth={1} rx={1.5} />
      {/* Small "q+" tag on the reservoir */}
      <text
        x={-5}
        y={-1.5}
        fill="#F97316"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={7}
        textAnchor="middle"
        style={{ userSelect: 'none' }}
      >
        q+
      </text>

      {/* Barrel — rotates with launch angle */}
      <g transform={`rotate(${rotDeg})`}>
        {/* Barrel body */}
        <polygon
          points={`0,${-BARREL_HALF} ${BARREL_LEN},${-BARREL_HALF + 0.5} ${BARREL_LEN},${BARREL_HALF - 0.5} 0,${BARREL_HALF}`}
          fill="#3A4863"
          stroke="#0D1524"
          strokeWidth={1}
        />
        {/* Muzzle ring */}
        <rect x={BARREL_LEN - 3} y={-BARREL_HALF - 1} width={3} height={2 * BARREL_HALF + 2} fill="#5A6479" rx={0.6} />
        {/* Chevron marking v-direction */}
        <polygon
          points={`${BARREL_LEN + 4},${-3} ${BARREL_LEN + 10},0 ${BARREL_LEN + 4},3`}
          fill="#37C9B8"
          opacity={0.85}
        />
      </g>

      {/* Front pivot pin */}
      <circle cx={0} cy={0} r={3} fill="#5A6479" stroke="#0D1524" strokeWidth={0.8} />
    </g>
  )
}
