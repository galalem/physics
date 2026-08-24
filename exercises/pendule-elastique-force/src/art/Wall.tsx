/** Fixed wall symbol — vertical bar + diagonal hatch marks on the anchor side. */
export function Wall({ x, yTop, yBottom }: { x: number; yTop: number; yBottom: number }) {
  const stroke = '#B9C4D6'
  const hatches: React.ReactNode[] = []
  const hatchSpacing = 10
  const hatchLen = 10
  for (let y = yTop; y <= yBottom; y += hatchSpacing) {
    hatches.push(
      <line
        key={`h${y}`}
        x1={x}
        y1={y}
        x2={x - hatchLen}
        y2={y + hatchLen}
        stroke={stroke}
        strokeWidth={1}
        opacity={0.7}
      />,
    )
  }
  return (
    <g>
      <line x1={x} y1={yTop} x2={x} y2={yBottom} stroke={stroke} strokeWidth={2.5} strokeLinecap="round" />
      {hatches}
    </g>
  )
}
