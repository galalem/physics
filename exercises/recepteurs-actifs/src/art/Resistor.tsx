/** IEC rectangle resistor. Horizontal only — dispatcher rotates for vertical slots. */
export function ResistorSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-18} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={18} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <rect x={-18} y={-8} width={36} height={16} fill="#131F35" stroke="#54617A" strokeWidth={1.4} />
      <text x={0} y={4} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">R</text>
    </g>
  )
}
