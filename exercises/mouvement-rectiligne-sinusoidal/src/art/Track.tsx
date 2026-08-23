// Track — horizontal rail on which the bob slides.
// Draws a subtle rail line, tick marks, the anchor wall at the left,
// and an origin (x = 0) hairline. Extends across the SVG in scene coords.

type Props = {
  x1: number
  x2: number
  y: number
  originX: number
  tickPositions: { x: number; label: string }[]
}

export function Track({ x1, x2, y, originX, tickPositions }: Props) {
  return (
    <g>
      {/* Anchor wall at the left */}
      <rect x={x1 - 18} y={y - 34} width={14} height={68} fill="#1E2A40" stroke="#3A4863" strokeWidth={1.2} rx={2} />
      {Array.from({ length: 6 }).map((_, i) => (
        <line
          key={`hatch${i}`}
          x1={x1 - 22}
          y1={y - 30 + i * 12}
          x2={x1 - 12}
          y2={y - 20 + i * 12}
          stroke="#3A4863"
          strokeWidth={0.9}
        />
      ))}

      {/* Rail */}
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="#3A4863" strokeWidth={2} />
      <line x1={x1} y1={y + 6} x2={x2} y2={y + 6} stroke="#12203a" strokeWidth={1} />

      {/* Origin hairline */}
      <line x1={originX} y1={y - 40} x2={originX} y2={y + 40} stroke="#37C9B8" strokeWidth={0.8} strokeDasharray="2 3" opacity={0.55} />
      <text
        x={originX}
        y={y + 52}
        fill="#54617A"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
      >
        x = 0
      </text>

      {/* Tick marks */}
      {tickPositions.map((t, i) => (
        <g key={`tick${i}`}>
          <line x1={t.x} y1={y - 4} x2={t.x} y2={y + 4} stroke="#3A4863" strokeWidth={1} />
          <text
            x={t.x}
            y={y + 20}
            fill="#54617A"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={9}
            textAnchor="middle"
          >
            {t.label}
          </text>
        </g>
      ))}
    </g>
  )
}
