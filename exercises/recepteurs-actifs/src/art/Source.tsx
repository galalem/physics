/**
 * Adjustable DC source with internal resistance r.
 * Battery symbol with a small "adjustable" arrow through the plates.
 * Horizontal by default; group-rotated by the dispatcher for vertical slots.
 */
export function SourceSymbol() {
  return (
    <g>
      <line x1={-32} y1={0} x2={-4} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={4} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      {/* Long plate (+), short plate (−) */}
      <line x1={-4} y1={-14} x2={-4} y2={14} stroke="#B9C4D6" strokeWidth={2} />
      <line x1={4} y1={-9} x2={4} y2={9} stroke="#B9C4D6" strokeWidth={5} />
      {/* Adjustable arrow (diagonal across) */}
      <line x1={-14} y1={12} x2={14} y2={-12} stroke="#F9A968" strokeWidth={1.4} />
      <polygon points="14,-12 8,-11 12,-6" fill="#F9A968" />
      <text x={-14} y={-18} fill="#F9A968" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" fontWeight={700}>+</text>
      <text x={14} y={-18} fill="#7EE3D8" fontFamily="'JetBrains Mono', monospace" fontSize={10} textAnchor="middle" fontWeight={700}>−</text>
    </g>
  )
}
