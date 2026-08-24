// TargetOrbitRing — dashed circular orbit at a target radius. Shown in
// stage 2 with a period label; hidden entirely on the blind stage.
// { cx, cy, r, hit } = focus center + radius + hit state.

export function TargetOrbitRing({
  cx,
  cy,
  r,
  hit,
}: {
  cx: number
  cy: number
  r: number
  hit: boolean
}) {
  const stroke = hit ? '#37C9B8' : '#6C7A93'
  const opacity = hit ? 0.85 : 0.5
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth={hit ? 1.6 : 1.2}
        strokeDasharray="4 6"
        opacity={opacity}
      />
      {/* marker dot on the +x axis (launch point) */}
      <circle
        cx={cx + r}
        cy={cy}
        r={2.2}
        fill={hit ? '#37C9B8' : '#54617A'}
        opacity={hit ? 1 : 0.7}
      />
    </g>
  )
}
