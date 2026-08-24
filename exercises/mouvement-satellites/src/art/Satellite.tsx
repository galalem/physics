// Satellite — small dot with solar panels flanking a central body.
// { x, y, angleRad } = center + orientation (barrel points along velocity).
// When `dragging` is true, an outer halo highlights it as the drag target.

export function Satellite({
  x,
  y,
  angleRad,
  dragging = false,
  inFlight = false,
}: {
  x: number
  y: number
  angleRad: number
  dragging?: boolean
  inFlight?: boolean
}) {
  const deg = (angleRad * 180) / Math.PI
  const halo = dragging || inFlight
  const glow = inFlight ? '#F97316' : '#37C9B8'
  return (
    <g transform={`translate(${x} ${y}) rotate(${deg})`}>
      {halo && <circle cx={0} cy={0} r={9} fill={glow} opacity={0.22} />}
      {/* solar panels */}
      <rect x={-8} y={-2} width={5} height={4} fill="#3A75C4" stroke="#6B9BD8" strokeWidth={0.5} />
      <rect x={3} y={-2} width={5} height={4} fill="#3A75C4" stroke="#6B9BD8" strokeWidth={0.5} />
      {/* body */}
      <rect x={-2.5} y={-2.5} width={5} height={5} fill="#EAF0FA" stroke="#37C9B8" strokeWidth={0.8} />
      {/* antenna */}
      <line x1={0} y1={-2.5} x2={0} y2={-5} stroke="#EAF0FA" strokeWidth={0.8} />
      <circle cx={0} cy={-5.5} r={0.9} fill="#F97316" />
    </g>
  )
}
