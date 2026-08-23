// GhostBob — the target-motion bob. Teal, hollow, slightly transparent.
// { x, y } = center in SVG coords.

export function GhostBob({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} opacity={0.85}>
      <circle cx={0} cy={0} r={13} fill="#37C9B8" opacity={0.15} />
      <circle cx={0} cy={0} r={9} fill="none" stroke="#37C9B8" strokeWidth={1.6} strokeDasharray="3 2" />
      <circle cx={0} cy={0} r={2} fill="#37C9B8" />
    </g>
  )
}
