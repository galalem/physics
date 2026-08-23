// StopZone — a vertical band on the track marking where the car should
// come to rest. `hit` toggles the palette from unlit (muted) to lit (teal).
// { x, y1, y2, width } — center-x, top y, bottom y, band half-width.

export function StopZone({
  cx,
  y1,
  y2,
  halfWidth,
  hit,
}: {
  cx: number
  y1: number
  y2: number
  halfWidth: number
  hit: boolean
}) {
  const fill = hit ? '#37C9B8' : '#54617A'
  const stroke = hit ? '#37C9B8' : '#6C7A93'
  return (
    <g>
      <rect
        x={cx - halfWidth}
        y={y1}
        width={halfWidth * 2}
        height={y2 - y1}
        fill={fill}
        opacity={hit ? 0.25 : 0.12}
      />
      <line x1={cx} y1={y1} x2={cx} y2={y2} stroke={stroke} strokeWidth={1.2} strokeDasharray="3 3" />
      {/* small flag on top */}
      <polygon
        points={`${cx},${y1 - 4} ${cx + 8},${y1 - 1} ${cx},${y1 + 2}`}
        fill={fill}
        stroke={stroke}
        strokeWidth={0.8}
      />
    </g>
  )
}
