// VectorArrow — a labelled straight arrow from (x1, y1) to (x2, y2) in SVG coords.
// Colour + label are props; head is drawn as a small triangle.

type Props = {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  label?: string
  labelOffset?: number
  strokeWidth?: number
  headSize?: number
  opacity?: number
}

export function VectorArrow({
  x1, y1, x2, y2, color, label, labelOffset = 10, strokeWidth = 2.4, headSize = 8, opacity = 1,
}: Props) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (len < 0.5) return null
  const ux = dx / len
  const uy = dy / len
  // Backtrack a fraction of head into the shaft so the shaft ends before the tip.
  const shaftEndX = x2 - ux * (headSize * 0.6)
  const shaftEndY = y2 - uy * (headSize * 0.6)
  // Head triangle (isosceles).
  const perpX = -uy
  const perpY = ux
  const baseX = x2 - ux * headSize
  const baseY = y2 - uy * headSize
  const leftX = baseX + perpX * headSize * 0.5
  const leftY = baseY + perpY * headSize * 0.5
  const rightX = baseX - perpX * headSize * 0.5
  const rightY = baseY - perpY * headSize * 0.5

  // Label sits near the mid-shaft, offset perpendicular.
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const labelX = midX + perpX * labelOffset
  const labelY = midY + perpY * labelOffset

  return (
    <g opacity={opacity}>
      <line x1={x1} y1={y1} x2={shaftEndX} y2={shaftEndY} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      <polygon points={`${x2},${y2} ${leftX},${leftY} ${rightX},${rightY}`} fill={color} />
      {label && (
        <text
          x={labelX}
          y={labelY}
          fill={color}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {label}
        </text>
      )}
    </g>
  )
}
