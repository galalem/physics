// FieldRegion — the magnetic-field zone. A softly tinted rectangle
// tiled with dots to indicate B pointing OUT of the page (⊙). The
// student's ion enters at the top-left of the region and curves inside it.

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
  const dotSpacing = 32
  const dots: React.ReactNode[] = []
  const startX = x + dotSpacing / 2
  const startY = y + dotSpacing / 2
  for (let dy = startY; dy < y + height; dy += dotSpacing) {
    for (let dx = startX; dx < x + width; dx += dotSpacing) {
      dots.push(
        <g key={`d-${dx}-${dy}`}>
          <circle cx={dx} cy={dy} r={4.5} fill="none" stroke="#2E3A57" strokeWidth={0.9} />
          <circle cx={dx} cy={dy} r={1.6} fill="#2E3A57" />
        </g>,
      )
    }
  }
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="#111C33"
        stroke="#2A3244"
        strokeWidth={1.2}
        rx={4}
      />
      {dots}
    </g>
  )
}
