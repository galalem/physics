// Wall — anchor for the spring on the left of the schematic.
// Draws a solid vertical bar with diagonal hatching behind it.

type Props = {
  x: number
  y: number
  height: number
}

export function Wall({ x, y, height }: Props) {
  const hatch: React.ReactNode[] = []
  const step = 8
  for (let i = 0; i <= height; i += step) {
    hatch.push(
      <line
        key={`h${i}`}
        x1={x - 14}
        y1={y + i}
        x2={x}
        y2={y + i - 10}
        stroke="#3A4863"
        strokeWidth={1}
      />,
    )
  }
  return (
    <g>
      {hatch}
      <line x1={x} y1={y} x2={x} y2={y + height} stroke="#54617A" strokeWidth={2} />
    </g>
  )
}
