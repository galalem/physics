// Fly — the marked point being tracked. Small orange dot with a soft
// glow. { x, y } = SVG center.

export function Fly({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx={0} cy={0} r={7} fill="#F97316" opacity={0.25} />
      <circle cx={0} cy={0} r={3.2} fill="#F97316" stroke="#FFD9B0" strokeWidth={0.8} />
      {/* Tiny wings */}
      <ellipse cx={-3.5} cy={-2} rx={2.2} ry={1.1} fill="#EAF0FA" opacity={0.55} />
      <ellipse cx={3.5} cy={-2} rx={2.2} ry={1.1} fill="#EAF0FA" opacity={0.55} />
    </g>
  )
}
