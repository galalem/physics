// Bob — the moving mass on the rail. Orange = student-controlled.
// { x, y } = center in SVG coords.

export function Bob({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx={0} cy={0} r={14} fill="#F97316" opacity={0.22} />
      <circle cx={0} cy={0} r={9} fill="#1A1F2E" stroke="#F97316" strokeWidth={1.8} />
      <circle cx={-2.2} cy={-2.2} r={2.2} fill="#F9A968" opacity={0.85} />
    </g>
  )
}
