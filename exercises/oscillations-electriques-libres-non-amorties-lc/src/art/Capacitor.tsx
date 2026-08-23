interface Props {
  /** center x in SVG viewBox units */
  x: number
  /** center y in SVG viewBox units */
  y: number
  /** capacitance in farads — for the label chip */
  c: number
  /** current u_C — sign fills the "positive" plate */
  uC: number
  /** initial voltage magnitude — for polarity indication */
  u0: number
}

/**
 * Vertical capacitor drawn as two horizontal plates.
 * Wire-endpoints sit at (x, y-8) and (x, y+8).
 * Plate coloring reflects sign of u_C: positive plate glows teal.
 */
export function Capacitor({ x, y, c, uC, u0 }: Props) {
  const plateW = 22
  const plateGap = 4
  const topPlateY = y - plateGap
  const botPlateY = y + plateGap

  // Show sign of u_C by tinting the "positive" plate.
  const posColor = '#37C9B8'
  const neuColor = '#B7C0D2'
  const topActive = uC > 0.15 * u0
  const botActive = uC < -0.15 * u0

  return (
    <g>
      {/* Wire stubs — external wires attach to the plates */}
      <line
        x1={x}
        y1={topPlateY - 8}
        x2={x}
        y2={topPlateY}
        stroke="#54617A"
        strokeWidth={1.6}
      />
      <line
        x1={x}
        y1={botPlateY}
        x2={x}
        y2={botPlateY + 8}
        stroke="#54617A"
        strokeWidth={1.6}
      />
      {/* Top plate */}
      <line
        x1={x - plateW / 2}
        y1={topPlateY}
        x2={x + plateW / 2}
        y2={topPlateY}
        stroke={topActive ? posColor : neuColor}
        strokeWidth={topActive ? 3.4 : 2.6}
        strokeLinecap="round"
      />
      {/* Bottom plate */}
      <line
        x1={x - plateW / 2}
        y1={botPlateY}
        x2={x + plateW / 2}
        y2={botPlateY}
        stroke={botActive ? posColor : neuColor}
        strokeWidth={botActive ? 3.4 : 2.6}
        strokeLinecap="round"
      />
      {/* Label */}
      <text
        x={x + plateW / 2 + 8}
        y={y + 3}
        fill="#B7C0D2"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="start"
      >
        C
      </text>
      <text
        x={x + plateW / 2 + 8}
        y={y + 15}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        textAnchor="start"
      >
        {Math.round(c * 1e6)} µF
      </text>
    </g>
  )
}
