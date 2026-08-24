// Ground — horizontal surface line under the spring-mass system, with hatching.

type Props = {
  x1: number
  x2: number
  y: number
}

export function Ground({ x1, x2, y }: Props) {
  const hatch: React.ReactNode[] = []
  const step = 10
  for (let x = x1; x <= x2; x += step) {
    hatch.push(
      <line
        key={`gh${x}`}
        x1={x}
        y1={y}
        x2={x - 8}
        y2={y + 8}
        stroke="#3A4863"
        strokeWidth={1}
      />,
    )
  }
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="#54617A" strokeWidth={2} />
      {hatch}
    </g>
  )
}
