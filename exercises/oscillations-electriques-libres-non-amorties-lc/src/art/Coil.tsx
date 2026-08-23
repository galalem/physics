interface Props {
  /** center x in SVG viewBox units */
  x: number
  /** center y in SVG viewBox units */
  y: number
  /** inductance in henries — for the label chip */
  l: number
  /** teal/orange highlight when current is flowing */
  active?: boolean
}

/**
 * Horizontal coil (inductor) drawn as 4 loops on the top rail.
 * Wire-endpoints sit at (x-22, y) and (x+22, y) — matches Resistor pinout.
 */
export function Coil({ x, y, l, active = false }: Props) {
  const arcColor = active ? '#37C9B8' : '#B7C0D2'
  const arcWidth = active ? 2.0 : 1.5
  const loops = 4
  const loopWidth = 10
  const totalWidth = loops * loopWidth
  const startX = x - totalWidth / 2
  // Each loop is a half-circle bumping upward.
  const arcs = []
  for (let i = 0; i < loops; i++) {
    const cx = startX + i * loopWidth
    const d = `M ${cx} ${y} a ${loopWidth / 2} ${loopWidth / 2} 0 0 1 ${loopWidth} 0`
    arcs.push(
      <path
        key={`arc${i}`}
        d={d}
        fill="none"
        stroke={arcColor}
        strokeWidth={arcWidth}
        strokeLinecap="round"
      />,
    )
  }
  return (
    <g>
      {/* Left stub connecting outer wire to coil */}
      <line x1={x - 22} y1={y} x2={startX} y2={y} stroke={arcColor} strokeWidth={arcWidth} />
      {/* Right stub */}
      <line
        x1={startX + totalWidth}
        y1={y}
        x2={x + 22}
        y2={y}
        stroke={arcColor}
        strokeWidth={arcWidth}
      />
      {arcs}
      {/* Label */}
      <text
        x={x}
        y={y - 14}
        fill="#B7C0D2"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle"
      >
        L
      </text>
      <text
        x={x}
        y={y + 20}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        textAnchor="middle"
      >
        {l >= 1 ? `${l.toFixed(2)} H` : `${(l * 1000).toFixed(0)} mH`}
      </text>
    </g>
  )
}
