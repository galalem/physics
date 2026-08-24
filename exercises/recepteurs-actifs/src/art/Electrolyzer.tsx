/**
 * Electrolyzer glyph — two vertical bars (electrodes) in a beaker-shape.
 * `active` = current flowing → bubbles animate.
 */
export function ElectrolyzerSymbol({ active }: { active: boolean }) {
  return (
    <g>
      <line x1={-32} y1={0} x2={-14} y2={0} stroke="#54617A" strokeWidth={2} />
      <line x1={14} y1={0} x2={32} y2={0} stroke="#54617A" strokeWidth={2} />
      {/* Beaker U-shape */}
      <path
        d="M -14 -12 L -14 10 Q -14 14 -10 14 L 10 14 Q 14 14 14 10 L 14 -12"
        fill="#131F35"
        stroke="#54617A"
        strokeWidth={1.4}
      />
      {/* Electrolyte level line */}
      <line x1={-12} y1={-6} x2={12} y2={-6} stroke="#3A4863" strokeWidth={0.8} strokeDasharray="2 2" />
      {/* Electrodes */}
      <line x1={-6} y1={-8} x2={-6} y2={12} stroke="#B9C4D6" strokeWidth={1.8} />
      <line x1={6} y1={-8} x2={6} y2={12} stroke="#B9C4D6" strokeWidth={1.8} />
      {/* Bubbles when active */}
      {active && (
        <g>
          <circle cx={-6} cy={6} r={1.2} fill="#37C9B8">
            <animate attributeName="cy" values="12;-4;12" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0;0.9" dur="1.6s" repeatCount="indefinite" />
          </circle>
          <circle cx={6} cy={4} r={1.2} fill="#37C9B8">
            <animate attributeName="cy" values="12;-4;12" dur="1.6s" begin="0.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0;0.9" dur="1.6s" begin="0.4s" repeatCount="indefinite" />
          </circle>
          <circle cx={-6} cy={10} r={1} fill="#37C9B8">
            <animate attributeName="cy" values="12;-4;12" dur="1.6s" begin="0.8s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0;0.9" dur="1.6s" begin="0.8s" repeatCount="indefinite" />
          </circle>
        </g>
      )}
    </g>
  )
}
