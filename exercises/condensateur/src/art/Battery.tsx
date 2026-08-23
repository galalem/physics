/** Battery cell symbol drawn vertically (wires enter from top and bottom). */
export function Battery({ x, y, u }: { x: number; y: number; u: number }) {
  const plateGap = 6
  const longW = 22
  const shortW = 12
  const stroke = '#B9C4D6'
  return (
    <g>
      {/* Long plate (positive) — on TOP */}
      <line x1={x - longW / 2} y1={y - plateGap / 2} x2={x + longW / 2} y2={y - plateGap / 2} stroke={stroke} strokeWidth={2.5} />
      {/* Short plate (negative) — on BOTTOM */}
      <line x1={x - shortW / 2} y1={y + plateGap / 2} x2={x + shortW / 2} y2={y + plateGap / 2} stroke={stroke} strokeWidth={2.5} />
      {/* + / − markers to the right of the plates */}
      <text x={x + longW / 2 + 6} y={y - plateGap / 2 + 4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
        +
      </text>
      <text x={x + longW / 2 + 6} y={y + plateGap / 2 + 6} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11}>
        −
      </text>
      {/* U value label — to the left */}
      <text x={x - longW / 2 - 8} y={y + 4} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={12} textAnchor="end">
        U = {u.toFixed(1)} V
      </text>
    </g>
  )
}
