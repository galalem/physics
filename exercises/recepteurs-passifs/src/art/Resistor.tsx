export function ResistorSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-20} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={20} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-20} y={-9} width={40} height={18} fill="#131F35" stroke="#B9C4D6" strokeWidth={1.4} rx={2} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">R</text>
    </g>
  )
}
