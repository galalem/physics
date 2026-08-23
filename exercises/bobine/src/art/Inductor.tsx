/** Inductor (coil) symbol drawn horizontally as 4 arcs on top, center at (x, y). */
export function Inductor({ x, y, l }: { x: number; y: number; l: number }) {
  const totalW = 48
  const loops = 4
  const rArc = totalW / (2 * loops)
  const x0 = x - totalW / 2
  const stroke = '#B9C4D6'
  // Build 4 half-arcs opening downward, drawn on top of the wire line.
  const parts: string[] = []
  for (let i = 0; i < loops; i++) {
    const cx = x0 + rArc + i * 2 * rArc
    parts.push(`M ${cx - rArc} ${y} A ${rArc} ${rArc} 0 0 1 ${cx + rArc} ${y}`)
  }
  return (
    <g>
      {/* Connecting wire underneath */}
      <line x1={x0} y1={y} x2={x0 + totalW} y2={y} stroke={stroke} strokeWidth={2} />
      <path d={parts.join(' ')} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      <text
        x={x}
        y={y - rArc - 8}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
        textAnchor="middle"
      >
        L = {formatL(l)}
      </text>
    </g>
  )
}

function formatL(l: number): string {
  if (l >= 1) return `${l.toFixed(l >= 10 ? 0 : 2)} H`
  return `${(l * 1000).toFixed(0)} mH`
}
