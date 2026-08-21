/** Ground symbol: 3 shrinking horizontal lines, tip at (x, y). */
export function Ground({ x, y }: { x: number; y: number }) {
  const stroke = '#B9C4D6'
  return (
    <g stroke={stroke} strokeWidth={2} strokeLinecap="round">
      <line x1={x - 14} y1={y} x2={x + 14} y2={y} />
      <line x1={x - 9} y1={y + 5} x2={x + 9} y2={y + 5} />
      <line x1={x - 4} y1={y + 10} x2={x + 4} y2={y + 10} />
    </g>
  )
}
