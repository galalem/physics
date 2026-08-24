// Ion — a small positively-charged particle in flight through the
// magnetic field. Soft orange glow tracks the ion so the eye stays on it
// against the field dots.

export function Ion({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx={0} cy={0} r={9} fill="#F97316" opacity={0.25} />
      <circle cx={0} cy={0} r={4.5} fill="#1A1F2E" stroke="#F97316" strokeWidth={1.4} />
      <text
        x={0}
        y={1.6}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={5}
        textAnchor="middle"
      >
        +
      </text>
    </g>
  )
}
