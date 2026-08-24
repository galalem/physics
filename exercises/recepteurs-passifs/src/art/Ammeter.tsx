export function AmmeterSymbol({ reading, hidden }: { reading: string; hidden: boolean }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-13} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={13} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>A</text>
      <text
        x={0}
        y={-20}
        fill={hidden ? '#6C7A93' : '#37C9B8'}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
      >
        {hidden ? '?' : reading}
      </text>
    </g>
  )
}
