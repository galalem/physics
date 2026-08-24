// Wall — brick block obstacle.
// { x, y } = top-left corner. width/height in SVG units.
// Simple brick pattern via horizontal + staggered vertical mortar lines.
// To swap in more detailed art later: keep the { x, y, width, height } signature.

export function Wall({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const brickH = 10
  const brickW = 20
  const rows: React.ReactNode[] = []
  for (let ry = 0; ry < height; ry += brickH) {
    const stagger = (Math.floor(ry / brickH) % 2) * (brickW / 2)
    // horizontal mortar line
    rows.push(
      <line
        key={`h${ry}`}
        x1={0}
        y1={ry}
        x2={width}
        y2={ry}
        stroke="#3E2C1A"
        strokeWidth={0.6}
      />,
    )
    // vertical mortar lines (staggered)
    for (let rx = stagger; rx < width; rx += brickW) {
      rows.push(
        <line
          key={`v${ry}-${rx}`}
          x1={rx}
          y1={ry}
          x2={rx}
          y2={Math.min(ry + brickH, height)}
          stroke="#3E2C1A"
          strokeWidth={0.6}
        />,
      )
    }
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={width} height={height} fill="#8B6F47" stroke="#3E2C1A" strokeWidth={1.5} rx={1} />
      {rows}
      {/* Top ridge highlight */}
      <line x1={0} y1={0} x2={width} y2={0} stroke="#A0855C" strokeWidth={1.2} />
    </g>
  )
}
