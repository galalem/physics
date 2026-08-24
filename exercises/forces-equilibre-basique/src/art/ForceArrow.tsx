// ForceArrow — vertical force vector rendered as a line + triangle head.
// dy > 0 draws downward (weight P); dy < 0 draws upward (reaction R).
// The tail sits at (x, y).

export function ForceArrow({
  x,
  y,
  dy,
  color,
  label,
}: {
  x: number
  y: number
  dy: number
  color: string
  label?: string
}) {
  const headSize = 6
  const yTip = y + dy
  const headBase = yTip - Math.sign(dy) * headSize
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={headBase} stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <polygon
        points={`${x},${yTip} ${x - headSize * 0.7},${headBase} ${x + headSize * 0.7},${headBase}`}
        fill={color}
      />
      {label && (
        <text
          x={x + 10}
          y={y + dy / 2 + 3}
          fill={color}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          fontWeight={700}
        >
          {label}
        </text>
      )}
    </g>
  )
}
