// Track — horizontal road with a dashed lane centerline and tick marks.
// { y } = road centerline SVG y-coord. `x1..x2` = extent along track.
// To swap in more detailed art later: keep the { y, x1, x2 } signature.

export function Track({ y, x1, x2 }: { y: number; x1: number; x2: number }) {
  const dashes: React.ReactNode[] = []
  const dashLen = 14
  const gap = 10
  for (let dx = x1; dx < x2; dx += dashLen + gap) {
    dashes.push(
      <line
        key={`d${dx}`}
        x1={dx}
        y1={y}
        x2={Math.min(dx + dashLen, x2)}
        y2={y}
        stroke="#F9E68A"
        strokeWidth={1.2}
        opacity={0.55}
      />,
    )
  }
  return (
    <g>
      {/* Asphalt band */}
      <rect x={x1} y={y - 14} width={x2 - x1} height={28} fill="#161C2C" />
      {/* Upper edge */}
      <line x1={x1} y1={y - 14} x2={x2} y2={y - 14} stroke="#3A4863" strokeWidth={1} />
      {/* Lower edge */}
      <line x1={x1} y1={y + 14} x2={x2} y2={y + 14} stroke="#3A4863" strokeWidth={1} />
      {/* Centerline dashes */}
      {dashes}
    </g>
  )
}
