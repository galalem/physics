/** SPDT switch: pivot at (x, y). Arm points to left, up, or right based on position. */
export type SwitchPos = 'charge' | 'open' | 'discharge'

export function Switch({ x, y, pos }: { x: number; y: number; pos: SwitchPos }) {
  const armLen = 26
  // Angle: charge = left (180°), open = up (270°), discharge = right (0°)
  const angleDeg = pos === 'charge' ? 210 : pos === 'discharge' ? -30 : -90
  const angle = (angleDeg * Math.PI) / 180
  const armX = x + Math.cos(angle) * armLen
  const armY = y + Math.sin(angle) * armLen
  // The two contact endpoints (left = charge, right = discharge)
  const contactY = y - 6
  const chargeContact = { x: x - armLen * Math.cos((30 * Math.PI) / 180), y: contactY - 4 }
  const dischargeContact = { x: x + armLen * Math.cos((30 * Math.PI) / 180), y: contactY - 4 }
  return (
    <g>
      {/* Contact terminals */}
      <circle cx={chargeContact.x} cy={chargeContact.y} r={3} fill={pos === 'charge' ? '#37C9B8' : '#3A4863'} />
      <circle cx={dischargeContact.x} cy={dischargeContact.y} r={3} fill={pos === 'discharge' ? '#F97316' : '#3A4863'} />
      {/* Pivot */}
      <circle cx={x} cy={y} r={3.5} fill="#B9C4D6" />
      {/* Arm */}
      <line
        x1={x}
        y1={y}
        x2={armX}
        y2={armY}
        stroke={pos === 'charge' ? '#37C9B8' : pos === 'discharge' ? '#F97316' : '#B9C4D6'}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      {/* K label */}
      <text x={x} y={y + 22} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
        K
      </text>
    </g>
  )
}
