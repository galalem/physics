// DetectorCell — a labelled bay on the detector strip. { x, y } = cell
// centre. `hit` swaps palette from unlit to lit. Height and width are the
// physical cell dimensions. The label sits ABOVE the strip so it never
// overlaps the ion's arriving arc.

export function DetectorCell({
  x,
  y,
  width,
  height,
  hit,
}: {
  x: number
  y: number
  width: number
  height: number
  hit: boolean
}) {
  const stroke = hit ? '#37C9B8' : '#54617A'
  const fill = hit ? '#37C9B8' : '#1E2A40'
  return (
    <g transform={`translate(${x} ${y})`}>
      {hit && <rect x={-width / 2 - 4} y={-height / 2 - 4} width={width + 8} height={height + 8} rx={2} fill="#37C9B8" opacity={0.18} />}
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.4}
        opacity={hit ? 0.55 : 1}
        rx={1.5}
      />
      {/* Center tick */}
      <line x1={-width / 2 + 1} y1={0} x2={width / 2 - 1} y2={0} stroke={hit ? '#0D1524' : '#3A4863'} strokeWidth={0.8} />
    </g>
  )
}
