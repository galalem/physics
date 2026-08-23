// Road — a flat horizontal line with a subtle dashed centre line to signal
// the "ground" / roadside reference. { y } is the SVG y of the road surface.

export function Road({ y, width }: { y: number; width: number }) {
  const dashes: React.ReactNode[] = []
  const dashLen = 22
  const gap = 18
  let x = 20
  let i = 0
  while (x < width - 20) {
    dashes.push(
      <line
        key={`d${i}`}
        x1={x}
        y1={y + 10}
        x2={x + dashLen}
        y2={y + 10}
        stroke="#4A5570"
        strokeWidth={1.4}
      />,
    )
    x += dashLen + gap
    i += 1
  }
  return (
    <g>
      <line x1={0} y1={y} x2={width} y2={y} stroke="#3A4863" strokeWidth={2} />
      <rect x={0} y={y} width={width} height={22} fill="#12203a" opacity={0.55} />
      {dashes}
    </g>
  )
}
