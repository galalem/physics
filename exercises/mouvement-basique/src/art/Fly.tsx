// Fly — small marker for point M. { x, y } = centre.
// `label` optional (e.g. "M") — drawn just above the marker.

export function Fly({ x, y, glow = false, label }: { x: number; y: number; glow?: boolean; label?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {glow && <circle cx={0} cy={0} r={9} fill="#F97316" opacity={0.22} />}
      <circle cx={0} cy={0} r={4} fill="#F97316" stroke="#0D1524" strokeWidth={0.8} />
      {/* Tiny wings */}
      <ellipse cx={-3.5} cy={-2.5} rx={2.5} ry={1.4} fill="#F9A968" opacity={0.85} />
      <ellipse cx={3.5} cy={-2.5} rx={2.5} ry={1.4} fill="#F9A968" opacity={0.85} />
      {label && (
        <text
          x={0}
          y={-10}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
          textAnchor="middle"
        >
          {label}
        </text>
      )}
    </g>
  )
}
