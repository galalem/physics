/** Negative-resistance amplifier symbol — a triangle (op-amp style) with a "-G" label.
 *  Drawn on the vertical left wire, apex pointing right. Center at (x, y).
 *  active=true colors the outline to signal the loss-compensation is engaged.
 */
export function Amplifier({
  x,
  y,
  g,
  active,
  saturated,
}: {
  x: number
  y: number
  g: number
  active: boolean
  saturated: boolean
}) {
  const size = 20
  const stroke = saturated ? '#F97316' : active ? '#37C9B8' : '#B9C4D6'
  // Triangle pointing right (apex at x + size, base at x - size/2)
  const p1 = `${x - size / 2},${y - size}`
  const p2 = `${x - size / 2},${y + size}`
  const p3 = `${x + size},${y}`
  return (
    <g>
      <polygon points={`${p1} ${p2} ${p3}`} fill="#0D1524" stroke={stroke} strokeWidth={1.8} />
      {/* input/output stubs so the triangle reads as an active element */}
      <line x1={x - size / 2 - 6} y1={y - 6} x2={x - size / 2} y2={y - 6} stroke={stroke} strokeWidth={1.4} />
      <line x1={x - size / 2 - 6} y1={y + 6} x2={x - size / 2} y2={y + 6} stroke={stroke} strokeWidth={1.4} />
      {/* "-" and "+" markers inside */}
      <text
        x={x - size / 2 + 4}
        y={y - 4}
        fill={stroke}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={8}
      >
        −
      </text>
      <text
        x={x - size / 2 + 4}
        y={y + 10}
        fill={stroke}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={8}
      >
        +
      </text>
      {/* Gain label to the left of the triangle */}
      <text
        x={x - size / 2 - 12}
        y={y - 22}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
        textAnchor="end"
      >
        −G = −{g.toFixed(0)} Ω
      </text>
    </g>
  )
}
