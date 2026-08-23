// Car — simple side-view sedan silhouette. { x, y } = bottom-centre of the
// car (its ground-contact point). `color` distinguishes car A / car B.
// The roof mount point for the fly is at (x, y - ROOF_OFFSET_Y).

export const CAR_ROOF_OFFSET = 32 // SVG px above ground contact to roof top

export function Car({ x, y, color = '#F97316', dim = false }: { x: number; y: number; color?: string; dim?: boolean }) {
  const body = dim ? '#3A4863' : color
  const window = dim ? '#12203a' : '#0D1524'
  return (
    <g transform={`translate(${x} ${y})`} opacity={dim ? 0.55 : 1}>
      {/* Shadow */}
      <ellipse cx={0} cy={2} rx={34} ry={2.5} fill="#000" opacity={0.35} />
      {/* Body */}
      <path
        d="M -34,-6 L -28,-14 L -14,-22 L 14,-22 L 22,-14 L 34,-6 L 34,-2 L -34,-2 Z"
        fill={body}
        stroke="#0D1524"
        strokeWidth={1}
      />
      {/* Cabin / windows */}
      <path
        d="M -22,-14 L -12,-20 L 12,-20 L 20,-14 Z"
        fill={window}
        stroke="#0D1524"
        strokeWidth={0.8}
      />
      <line x1={0} y1={-20} x2={0} y2={-14} stroke="#0D1524" strokeWidth={0.8} />
      {/* Wheels */}
      <circle cx={-20} cy={-2} r={5.5} fill="#1A1F2E" stroke="#0D1524" strokeWidth={1} />
      <circle cx={-20} cy={-2} r={2} fill="#3A4863" />
      <circle cx={20} cy={-2} r={5.5} fill="#1A1F2E" stroke="#0D1524" strokeWidth={1} />
      <circle cx={20} cy={-2} r={2} fill="#3A4863" />
    </g>
  )
}
