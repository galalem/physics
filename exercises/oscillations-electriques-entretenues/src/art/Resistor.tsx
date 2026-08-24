/** Zigzag resistor drawn horizontally, center at (x, y). */
export function Resistor({ x, y, r, labelBelow = false }: { x: number; y: number; r: number; labelBelow?: boolean }) {
  const w = 44
  const h = 10
  const x0 = x - w / 2
  const stroke = '#B9C4D6'
  const pts: string[] = [`M ${x0} ${y}`]
  const seg = w / 7
  for (let i = 1; i <= 6; i++) {
    const px = x0 + i * seg
    const py = y + (i % 2 === 1 ? -h : h)
    pts.push(`L ${px} ${py}`)
  }
  pts.push(`L ${x + w / 2} ${y}`)
  return (
    <g>
      <path d={pts.join(' ')} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="miter" />
      <text
        x={x}
        y={labelBelow ? y + 24 : y - 18}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
        textAnchor="middle"
      >
        R = {r} Ω
      </text>
    </g>
  )
}
