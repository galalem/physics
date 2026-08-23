// Puck — sliding disc on the horizontal track.
// { x, y } = center in SVG coords.

export function Puck({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={0} cy={4} rx={12} ry={2.5} fill="#000" opacity={0.35} />
      <circle cx={0} cy={0} r={11} fill="#F97316" opacity={0.18} />
      <circle cx={0} cy={0} r={7} fill="#1A1F2E" stroke="#F97316" strokeWidth={1.5} />
      <circle cx={-1.5} cy={-1.5} r={1.6} fill="#5A6479" opacity={0.7} />
    </g>
  )
}
