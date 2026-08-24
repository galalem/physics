/** Coil / inductor drawn horizontally as a series of arcs, center at (x, y). */
export function Inductor({ x, y, l }: { x: number; y: number; l: number }) {
  const totalW = 60
  const nArcs = 4
  const arcR = totalW / (nArcs * 2)
  const x0 = x - totalW / 2
  const stroke = '#B9C4D6'
  const path: string[] = [`M ${x0} ${y}`]
  for (let i = 0; i < nArcs; i++) {
    const cx = x0 + (i * 2 + 1) * arcR
    // half-circle arc from left to right on top of baseline
    path.push(`A ${arcR} ${arcR} 0 0 1 ${cx + arcR} ${y}`)
  }
  return (
    <g>
      <path d={path.join(' ')} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      <text
        x={x}
        y={y - 18}
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
