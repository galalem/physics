/** SPDT switch: pivot at (x, y). Arm points to left, up, or right based on position. */
export type SwitchPos = 'establish' | 'open' | 'break'

export function Switch({ x, y, pos }: { x: number; y: number; pos: SwitchPos }) {
  const armLen = 26
  const angleDeg = pos === 'establish' ? 210 : pos === 'break' ? -30 : -90
  const angle = (angleDeg * Math.PI) / 180
  const armX = x + Math.cos(angle) * armLen
  const armY = y + Math.sin(angle) * armLen
  const contactY = y - 6
  const establishContact = { x: x - armLen * Math.cos((30 * Math.PI) / 180), y: contactY - 4 }
  const breakContact = { x: x + armLen * Math.cos((30 * Math.PI) / 180), y: contactY - 4 }
  return (
    <g>
      <circle cx={establishContact.x} cy={establishContact.y} r={3} fill={pos === 'establish' ? '#37C9B8' : '#3A4863'} />
      <circle cx={breakContact.x} cy={breakContact.y} r={3} fill={pos === 'break' ? '#F97316' : '#3A4863'} />
      <circle cx={x} cy={y} r={3.5} fill="#B9C4D6" />
      <line
        x1={x}
        y1={y}
        x2={armX}
        y2={armY}
        stroke={pos === 'establish' ? '#37C9B8' : pos === 'break' ? '#F97316' : '#B9C4D6'}
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      <text x={x} y={y + 22} fill="#6C7A93" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle">
        K
      </text>
    </g>
  )
}
