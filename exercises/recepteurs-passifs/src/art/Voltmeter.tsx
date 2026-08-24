export function VoltmeterSymbol({ reading, hidden }: { reading: string; hidden: boolean }) {
  return (
    <g>
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>V</text>
      <text
        x={22}
        y={4}
        fill={hidden ? '#6C7A93' : '#37C9B8'}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="start"
      >
        {hidden ? '?' : reading}
      </text>
    </g>
  )
}
