/** AC source symbol: circle with a sine wave inside. Center at (x, y). */
export function ACSource({
  x,
  y,
  uMax,
  f,
}: {
  x: number
  y: number
  uMax: number
  f: number
}) {
  const r = 22
  const stroke = '#B9C4D6'
  // Build a small sine wave inside the circle: 1 period across the diameter
  const inner: string[] = []
  const w = r * 1.4
  const h = r * 0.55
  const steps = 40
  for (let i = 0; i <= steps; i++) {
    const px = x - w / 2 + (i / steps) * w
    const py = y - h * Math.sin((i / steps) * 2 * Math.PI)
    inner.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`)
  }
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill="#0D1524" stroke={stroke} strokeWidth={2} />
      <path d={inner.join(' ')} fill="none" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" />
      {/* + / - polarity marks (instantaneous — the source alternates, marks are conventional) */}
      <text
        x={x}
        y={y - r - 8}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle"
      >
        U_max = {uMax.toFixed(1)} V
      </text>
      <text
        x={x}
        y={y + r + 18}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle"
      >
        f = {Math.round(f)} Hz
      </text>
    </g>
  )
}
