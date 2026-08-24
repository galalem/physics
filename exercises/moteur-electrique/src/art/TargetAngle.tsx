// Target angle marker — a bullseye placed on the rotor's tip circle at angle θ.
// θ = angle in radians measured counter-clockwise from +x (math convention).
// SVG y is down, so we negate the sine when converting to screen coords.

export function TargetAngle({
  cx,
  cy,
  R,
  theta,
  hit,
  label,
}: {
  cx: number
  cy: number
  R: number
  theta: number
  hit: boolean
  label?: string
}) {
  const px = cx + R * Math.cos(theta)
  const py = cy - R * Math.sin(theta)
  const ringOuter = hit ? '#37C9B8' : '#6C7A93'
  const ringInner = hit ? '#1FA595' : '#54617A'
  const centerFill = hit ? '#F97316' : '#3A4863'
  // Label sits just outside the ring, radially further out.
  const labelR = R + 28
  const lx = cx + labelR * Math.cos(theta)
  const ly = cy - labelR * Math.sin(theta)
  return (
    <g>
      {hit && <circle cx={px} cy={py} r={16} fill="#37C9B8" opacity={0.2} />}
      <circle cx={px} cy={py} r={10} fill="none" stroke={ringOuter} strokeWidth={2} />
      <circle cx={px} cy={py} r={6.5} fill="none" stroke={ringInner} strokeWidth={2} />
      <circle cx={px} cy={py} r={2.8} fill={centerFill} />
      {label && (
        <text
          x={lx}
          y={ly + 3}
          fill="#F9A968"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
        >
          {label}
        </text>
      )}
    </g>
  )
}
