// Pedestrian — a stick figure standing on the road. { x, y } = feet position.
// Kept intentionally simple: circle head + torso + legs + arms.

export function Pedestrian({ x, y, dim = false }: { x: number; y: number; dim?: boolean }) {
  const stroke = dim ? '#54617A' : '#B9C4D6'
  return (
    <g transform={`translate(${x} ${y})`} opacity={dim ? 0.55 : 1}>
      {/* Shadow */}
      <ellipse cx={0} cy={0} rx={7} ry={1.5} fill="#000" opacity={0.35} />
      {/* Legs */}
      <line x1={-3} y1={-1} x2={-4} y2={-14} stroke={stroke} strokeWidth={2} />
      <line x1={3} y1={-1} x2={4} y2={-14} stroke={stroke} strokeWidth={2} />
      {/* Torso */}
      <line x1={0} y1={-14} x2={0} y2={-26} stroke={stroke} strokeWidth={2.2} />
      {/* Arms */}
      <line x1={0} y1={-22} x2={-6} y2={-16} stroke={stroke} strokeWidth={2} />
      <line x1={0} y1={-22} x2={6} y2={-16} stroke={stroke} strokeWidth={2} />
      {/* Head */}
      <circle cx={0} cy={-30} r={4} fill="none" stroke={stroke} strokeWidth={2} />
    </g>
  )
}
