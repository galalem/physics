// Projectile — cannonball with soft glow while in flight.
// { x, y } = center in SVG coords.

export function Projectile({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx={0} cy={0} r={10} fill="#F97316" opacity={0.25} />
      <circle cx={0} cy={0} r={5} fill="#1A1F2E" stroke="#F97316" strokeWidth={1.5} />
      <circle cx={-1.3} cy={-1.3} r={1.4} fill="#5A6479" opacity={0.7} />
    </g>
  )
}
