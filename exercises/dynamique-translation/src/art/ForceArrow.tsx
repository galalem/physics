// ForceArrow — horizontal SVG arrow representing a force vector.
// { x, y } = tail position. `length` is signed (positive → right, negative → left).
// `color` and `label` are self-explanatory. Head is a small triangle.

export function ForceArrow({
  x,
  y,
  length,
  color,
  label,
  labelOffset = -6,
}: {
  x: number
  y: number
  length: number
  color: string
  label?: string
  labelOffset?: number
}) {
  const absLen = Math.abs(length)
  if (absLen < 1) return null
  const dir = length >= 0 ? 1 : -1
  const headLen = 6
  const headW = 4
  const shaftEnd = length - dir * headLen
  return (
    <g transform={`translate(${x} ${y})`}>
      <line
        x1={0}
        y1={0}
        x2={shaftEnd}
        y2={0}
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      <polygon
        points={`${length},0 ${shaftEnd},${-headW} ${shaftEnd},${headW}`}
        fill={color}
      />
      {label && (
        <text
          x={length / 2}
          y={labelOffset}
          fill={color}
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
          fontWeight={700}
        >
          {label}
        </text>
      )}
    </g>
  )
}
