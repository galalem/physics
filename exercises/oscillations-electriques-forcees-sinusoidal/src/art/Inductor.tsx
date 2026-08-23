/** Inductor — four coils drawn horizontally, center at (x, y). */
export function Inductor({ x, y, l }: { x: number; y: number; l: number }) {
  const w = 44
  const arcR = w / 8
  const x0 = x - w / 2
  const stroke = '#B9C4D6'
  // Four half-loops facing up
  let d = `M ${x0} ${y} `
  for (let i = 0; i < 4; i++) {
    const cx = x0 + (i + 0.5) * (w / 4)
    d += `A ${arcR} ${arcR} 0 0 1 ${cx + arcR} ${y} `
  }
  return (
    <g>
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      <text
        x={x}
        y={y - 12}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle"
      >
        L = {l} H
      </text>
    </g>
  )
}
