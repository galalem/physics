// Particle — charged particle with soft glow while in flight.
// { x, y } = center in SVG coords.
// `sign` toggles the label + tint: '+' (orange) or '-' (teal).

export function Particle({ x, y, sign }: { x: number; y: number; sign: 1 | -1 }) {
  const ring = sign === 1 ? '#F97316' : '#37C9B8'
  const label = sign === 1 ? '+' : '−'
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx={0} cy={0} r={10} fill={ring} opacity={0.25} />
      <circle cx={0} cy={0} r={5} fill="#1A1F2E" stroke={ring} strokeWidth={1.5} />
      <text
        x={0}
        y={2}
        fill={ring}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={7}
        fontWeight={700}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  )
}
