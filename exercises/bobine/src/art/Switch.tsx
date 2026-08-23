export type SwitchPos = 'open' | 'closed'

/**
 * SPST switch. Pivot on the left, arm swings to the right contact when closed.
 * Wires enter from left and right on the same horizontal line.
 */
export function Switch({ x, y, pos }: { x: number; y: number; pos: SwitchPos }) {
  const armLen = 22
  const stroke = '#B9C4D6'
  const closedColor = '#37C9B8'
  const armStroke = pos === 'closed' ? closedColor : stroke
  // Left pivot pad
  const pivotX = x - armLen / 2
  // Right contact pad
  const contactX = x + armLen / 2
  // Arm endpoint: when open, angled up ~35°; when closed, horizontal to contact
  const angle = pos === 'closed' ? 0 : -35
  const rad = (angle * Math.PI) / 180
  const armEndX = pivotX + armLen * Math.cos(rad)
  const armEndY = y + armLen * Math.sin(rad)
  return (
    <g>
      {/* Pivot dot */}
      <circle cx={pivotX} cy={y} r={2.5} fill={stroke} />
      {/* Right contact dot */}
      <circle cx={contactX} cy={y} r={2.5} fill={stroke} />
      {/* Arm */}
      <line x1={pivotX} y1={y} x2={armEndX} y2={armEndY} stroke={armStroke} strokeWidth={2.5} strokeLinecap="round" />
      {/* K label */}
      <text
        x={x}
        y={y - 22}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
        textAnchor="middle"
      >
        K
      </text>
    </g>
  )
}
