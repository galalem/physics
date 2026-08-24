export function CoilSymbol() {
  // Four half-circle humps forming an inductor coil
  return (
    <g>
      <line x1={-32} y1={0} x2={-20} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={20} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      <path
        d="M -20 0 A 5 5 0 0 1 -10 0 A 5 5 0 0 1 0 0 A 5 5 0 0 1 10 0 A 5 5 0 0 1 20 0"
        fill="none"
        stroke="#B9C4D6"
        strokeWidth={2}
      />
      <text x={0} y={-12} fill="#B9C4D6" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle">L</text>
    </g>
  )
}
