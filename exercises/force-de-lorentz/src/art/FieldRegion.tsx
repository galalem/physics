// FieldRegion — a rectangular uniform magnetic field, drawn as a grid of
// small dots to indicate B pointing OUT of the page. { x, y, width,
// height } is the rectangle in SVG coordinates.

export function FieldRegion({
  x,
  y,
  width,
  height,
}: {
  x: number
  y: number
  width: number
  height: number
}) {
  const step = 40
  const dots: React.ReactNode[] = []
  for (let dx = step; dx < width; dx += step) {
    for (let dy = step; dy < height; dy += step) {
      dots.push(
        <g key={`d${dx}-${dy}`}>
          {/* Outer ring — represents the head of an arrow poking through */}
          <circle cx={x + dx} cy={y + dy} r={3.2} fill="none" stroke="#37C9B8" strokeWidth={0.9} opacity={0.55} />
          {/* Inner dot */}
          <circle cx={x + dx} cy={y + dy} r={1.2} fill="#37C9B8" opacity={0.85} />
        </g>,
      )
    }
  }
  return (
    <g>
      {/* Field boundary */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="#0F1B30"
        stroke="#1F3055"
        strokeWidth={1.2}
        strokeDasharray="4 3"
        opacity={0.9}
        rx={6}
      />
      {dots}
    </g>
  )
}
