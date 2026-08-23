/** Zig-zag resistor drawn horizontally, center at (x, y). Fixed internal resistance label. */
export function Resistor({ x, y, r }: { x: number; y: number; r: number }) {
  const w = 44
  const h = 10
  const stroke = '#B9C4D6'
  // Zig-zag path
  const steps = 6
  const stepW = w / steps
  let d = `M ${x - w / 2} ${y}`
  for (let i = 0; i < steps; i++) {
    const sx = x - w / 2 + (i + 1) * stepW
    const sy = i % 2 === 0 ? y - h / 2 : y + h / 2
    d += ` L ${sx} ${sy}`
  }
  d += ` L ${x + w / 2} ${y}`
  return (
    <g>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" />
      <text x={x} y={y - 12} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">
        R = {(r / 1000).toFixed(1)}k
      </text>
    </g>
  )
}
