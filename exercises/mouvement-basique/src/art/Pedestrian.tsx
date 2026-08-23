// Pedestrian — stick figure walking at an angle across the sidewalk.
// { x, y } = feet position (bottom-centre).

export function Pedestrian({ x, y, dim = false }: { x: number; y: number; dim?: boolean }) {
  const bodyStroke = dim ? '#3A4863' : '#B9C4D6'
  const headFill = dim ? '#3A4863' : '#EAF0FA'
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Head */}
      <circle cx={0} cy={-32} r={4.5} fill={headFill} stroke={bodyStroke} strokeWidth={0.8} />
      {/* Torso */}
      <line x1={0} y1={-27.5} x2={0} y2={-12} stroke={bodyStroke} strokeWidth={2} strokeLinecap="round" />
      {/* Arms — one raised, one down (walking pose) */}
      <line x1={0} y1={-24} x2={-5} y2={-18} stroke={bodyStroke} strokeWidth={1.6} strokeLinecap="round" />
      <line x1={0} y1={-24} x2={6} y2={-16} stroke={bodyStroke} strokeWidth={1.6} strokeLinecap="round" />
      {/* Legs — walking stride */}
      <line x1={0} y1={-12} x2={-4} y2={0} stroke={bodyStroke} strokeWidth={2} strokeLinecap="round" />
      <line x1={0} y1={-12} x2={5} y2={0} stroke={bodyStroke} strokeWidth={2} strokeLinecap="round" />
    </g>
  )
}
