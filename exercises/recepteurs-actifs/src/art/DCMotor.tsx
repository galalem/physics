/**
 * DC motor glyph — circle with "M" and a rotor line that spins when active.
 */
export function DCMotorSymbol({ active }: { active: boolean }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={14} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>M</text>
      {/* Rotor tick (spins when active) */}
      <g>
        <line x1={0} y1={-10} x2={0} y2={-14} stroke="#F9A968" strokeWidth={1.6}>
          {active && (
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 0 0"
              to="360 0 0"
              dur="1s"
              repeatCount="indefinite"
            />
          )}
        </line>
      </g>
    </g>
  )
}
