// Particle — small glowing electron dot with a −e label halo.
// { x, y } = center in SVG coords.

export function Particle({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx={0} cy={0} r={8} fill="#37C9B8" opacity={0.25} />
      <circle cx={0} cy={0} r={3.5} fill="#37C9B8" stroke="#0D1524" strokeWidth={0.6} />
      <text
        x={0}
        y={-8}
        fill="#37C9B8"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={7}
        textAnchor="middle"
      >
        e⁻
      </text>
    </g>
  )
}
