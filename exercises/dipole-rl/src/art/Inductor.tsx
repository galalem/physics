/** Inductor (stacked half-loops) drawn vertically, center at (x, y).
 *  Glow intensity ties to |i|/I_max so the coil "brightens" as current flows. */
export function Inductor({
  x,
  y,
  l,
  i,
  iMax,
}: {
  x: number
  y: number
  l: number
  i: number
  iMax: number
}) {
  const stroke = '#B9C4D6'
  const activeStroke = '#37C9B8'
  const fillRatio = Math.max(0, Math.min(1, iMax > 0 ? i / iMax : 0))
  const bumpColor = fillRatio > 0.02 ? activeStroke : stroke
  const bumpW = 2 + fillRatio * 1
  const loops = 4
  const loopH = 8
  const loopR = 6
  const totalH = loops * loopH
  const y0 = y - totalH / 2
  // Draw `loops` half-circles opening to the LEFT so the coil column reads as
  // a vertical stack of bumps. Path: M start, then a series of `a` arcs.
  let d = `M ${x} ${y0}`
  for (let k = 0; k < loops; k++) {
    // Sweep flag 0 draws the arc bulging LEFT of the vertical baseline.
    d += ` a ${loopR} ${loopH / 2} 0 0 0 0 ${loopH}`
  }
  return (
    <g>
      <path d={d} fill="none" stroke={bumpColor} strokeWidth={bumpW} strokeLinecap="round" />
      {/* Magnetic-field glow (subtle halo when current flows) */}
      {fillRatio > 0.02 && (
        <ellipse
          cx={x - loopR / 2}
          cy={y}
          rx={loopR + 2}
          ry={totalH / 2 + 2}
          fill="none"
          stroke={activeStroke}
          strokeWidth={0.6}
          opacity={0.25 + 0.4 * fillRatio}
        />
      )}
      <text
        x={x + loopR + 6}
        y={y + 4}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
      >
        L = {formatL(l)}
      </text>
    </g>
  )
}

function formatL(l: number): string {
  if (l >= 1) return `${l.toFixed(2)} H`
  if (l >= 1e-3) return `${(l * 1e3).toFixed(0)} mH`
  return `${(l * 1e6).toFixed(0)} µH`
}
