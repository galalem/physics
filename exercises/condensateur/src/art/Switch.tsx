/** Simple SPST switch: pivot at (x, y). Arm rests horizontal when closed, tilted up when open. */
export type SwitchPos = 'open' | 'closed'

export function Switch({ x, y, pos }: { x: number; y: number; pos: SwitchPos }) {
  const armLen = 30
  // Closed: arm horizontal to the right. Open: arm tilted up 40°.
  const angleDeg = pos === 'closed' ? 0 : -40
  const angle = (angleDeg * Math.PI) / 180
  const armX = x + Math.cos(angle) * armLen
  const armY = y + Math.sin(angle) * armLen
  // Right contact (fixed terminal the arm reaches when closed)
  const rightContact = { x: x + armLen, y }
  return (
    <g>
      {/* Left pivot terminal */}
      <circle cx={x} cy={y} r={3.5} fill="#B9C4D6" />
      {/* Right contact terminal */}
      <circle cx={rightContact.x} cy={rightContact.y} r={3} fill={pos === 'closed' ? '#37C9B8' : '#3A4863'} />
      {/* Arm */}
      <line
        x1={x}
        y1={y}
        x2={armX}
        y2={armY}
        stroke={pos === 'closed' ? '#37C9B8' : '#B9C4D6'}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      {/* K label */}
      <text x={x + armLen / 2} y={y + 18} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
        K
      </text>
    </g>
  )
}
