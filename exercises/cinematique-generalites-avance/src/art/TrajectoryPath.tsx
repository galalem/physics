// TrajectoryPath — draws the pre-sampled path (list of SVG (x, y) points)
// as a smooth polyline. Colour + width tweakable.

type Pt = { x: number; y: number }

export function TrajectoryPath({
  points, color = '#37C9B8', width = 2, dashed = false, opacity = 1,
}: {
  points: Pt[]
  color?: string
  width?: number
  dashed?: boolean
  opacity?: number
}) {
  if (points.length < 2) return null
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeDasharray={dashed ? '4 5' : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
    />
  )
}
