// Target — flag on a pole planted in the ground.
// { x, y } = base of the flag pole (at ground level).
// `hit` swaps palette from unlit (muted) to lit (teal).

export function Target({ x, y, hit }: { x: number; y: number; hit: boolean }) {
  const poleColor = hit ? '#37C9B8' : '#6C7A93'
  const flagColor = hit ? '#37C9B8' : '#54617A'
  const centerFill = hit ? '#F97316' : '#3A4863'
  const H_POLE = 28
  return (
    <g transform={`translate(${x} ${y})`}>
      {hit && <circle cx={0} cy={-6} r={16} fill="#37C9B8" opacity={0.18} />}
      {/* Base plate on ground */}
      <ellipse cx={0} cy={0} rx={7} ry={2} fill={centerFill} opacity={0.7} />
      {/* Pole */}
      <line x1={0} y1={0} x2={0} y2={-H_POLE} stroke={poleColor} strokeWidth={2} />
      {/* Flag — triangular pennant */}
      <polygon
        points={`0,${-H_POLE} 16,${-H_POLE + 4} 0,${-H_POLE + 8}`}
        fill={flagColor}
        stroke={poleColor}
        strokeWidth={1}
      />
      {/* Base dot */}
      <circle cx={0} cy={0} r={2.5} fill={centerFill} />
    </g>
  )
}
