/** GBF (function generator) — circle with sinewave, wires enter top and bottom. */
export function Gbf({ x, y, uMax, label }: { x: number; y: number; uMax: number; label: string }) {
  const r = 18
  const stroke = '#B9C4D6'
  // Sinewave inside the circle
  const steps = 40
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const s = i / steps
    const px = x - r + 6 + s * (2 * r - 12)
    const py = y + Math.sin(s * Math.PI * 2) * 5.5
    d += `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)} `
  }
  return (
    <g>
      {/* Body circle */}
      <circle cx={x} cy={y} r={r} fill="#0D1524" stroke={stroke} strokeWidth={2} />
      {/* Sinewave */}
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} />
      {/* Label to the left */}
      <text
        x={x - r - 8}
        y={y - 4}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
        textAnchor="end"
      >
        {label}
      </text>
      <text
        x={x - r - 8}
        y={y + 10}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="end"
      >
        {`Umax=${uMax}V`}
      </text>
    </g>
  )
}
