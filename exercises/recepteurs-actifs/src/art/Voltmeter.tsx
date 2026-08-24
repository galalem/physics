/** Voltmeter symbol — circle with "V". Placed as a floating meter, not in the loop. */
export function VoltmeterSymbol({ reading, showReading }: { reading: number; showReading: boolean }) {
  const readingColor = reading > 0.001 ? '#37C9B8' : '#6C7A93'
  return (
    <g>
      <circle cx={0} cy={0} r={13} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={11} textAnchor="middle" fontWeight={700}>V</text>
      <text x={0} y={-20} fill={readingColor} fontFamily="'JetBrains Mono', monospace" fontSize={9} textAnchor="middle">
        {showReading ? `${reading.toFixed(2)} V` : '?'}
      </text>
    </g>
  )
}
