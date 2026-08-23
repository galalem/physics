// Rendezvous — a beacon on the track marking (x*, t*) — the puck must
// be at x* exactly when t* elapses. `hit` swaps palette to teal + orange center.
// `blind` = stage 3 style (no ring animation).

export function Rendezvous({
  x,
  y,
  hit,
}: {
  x: number
  y: number
  hit: boolean
}) {
  const ringOuter = hit ? '#37C9B8' : '#6C7A93'
  const ringInner = hit ? '#1FA595' : '#54617A'
  const centerFill = hit ? '#F97316' : '#3A4863'
  return (
    <g transform={`translate(${x} ${y})`}>
      {hit && <circle cx={0} cy={0} r={18} fill="#37C9B8" opacity={0.2} />}
      {/* vertical pole down to the track */}
      <line x1={0} y1={0} x2={0} y2={22} stroke={ringOuter} strokeWidth={1.2} strokeDasharray="2 3" />
      <circle cx={0} cy={0} r={11} fill="none" stroke={ringOuter} strokeWidth={2} />
      <circle cx={0} cy={0} r={7} fill="none" stroke={ringInner} strokeWidth={2} />
      <circle cx={0} cy={0} r={3} fill={centerFill} />
    </g>
  )
}
