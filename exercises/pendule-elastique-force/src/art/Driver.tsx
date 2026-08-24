/**
 * Driving-force arrow, drawn above the mass.
 * Length + direction indicate the instantaneous sign & magnitude of F(t) = F0·cos(Ωt).
 */
export function Driver({
  cx,
  cy,
  forceNorm,
  color = '#F9A968',
}: {
  cx: number
  cy: number
  /** normalized force in [-1, 1] — sign gives direction, magnitude gives arrow length */
  forceNorm: number
  color?: string
}) {
  const maxLen = 34
  const len = maxLen * Math.abs(forceNorm)
  const dir = forceNorm >= 0 ? 1 : -1
  // Arrow tail at cx, head at cx + dir*len
  const tailX = cx
  const headX = cx + dir * len
  const head = 6
  return (
    <g stroke={color} fill={color} strokeLinecap="round">
      <line x1={tailX} y1={cy} x2={headX} y2={cy} strokeWidth={2} />
      {len > 3 && (
        <polygon
          points={`${headX},${cy} ${headX - dir * head},${cy - head * 0.7} ${headX - dir * head},${cy + head * 0.7}`}
        />
      )}
      <text
        x={cx}
        y={cy - 10}
        fill={color}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle"
      >
        F(t)
      </text>
    </g>
  )
}
