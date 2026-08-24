// Target — vertical crosshair marker on the phosphor screen.
// { x, y } = center. `hit` swaps palette from unlit to lit (teal).
// Shape: a small "]" bracket sitting flush against the screen, with a bullseye
// dot at the aim point.

export function Target({ x, y, hit }: { x: number; y: number; hit: boolean }) {
  const stroke = hit ? '#37C9B8' : '#F9A968'
  const dotFill = hit ? '#37C9B8' : '#F9A968'
  return (
    <g transform={`translate(${x} ${y})`}>
      {hit && <circle cx={0} cy={0} r={14} fill="#37C9B8" opacity={0.2} />}
      {/* Bracket: right-facing "]" so it sits against the vertical screen at x */}
      <path
        d="M 4 -8 L 12 -8 L 12 8 L 4 8"
        fill="none"
        stroke={stroke}
        strokeWidth={1.6}
      />
      {/* Bullseye dot at the aim point */}
      <circle cx={0} cy={0} r={3} fill={dotFill} />
      <circle cx={0} cy={0} r={6} fill="none" stroke={stroke} strokeWidth={1} opacity={0.7} />
    </g>
  )
}
