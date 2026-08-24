// Screen — vertical phosphor screen at the right side (oscilloscope-style).
// { x, yTop, yBot } = SVG geometry of the screen line + surround.
// Tick marks in cm on the outside (right) side of the screen.
// pxPerCm = SVG units per centimeter for tick spacing.

export function Screen({
  x,
  yTop,
  yBot,
  pxPerCm,
  yCenter,
  hitY,
}: {
  x: number
  yTop: number
  yBot: number
  pxPerCm: number
  yCenter: number
  hitY: number | null
}) {
  const ticks: React.ReactNode[] = []
  const maxCm = Math.floor((yBot - yCenter) / pxPerCm)
  for (let cm = -maxCm; cm <= maxCm; cm++) {
    const ty = yCenter - cm * pxPerCm
    const long = cm % 5 === 0
    ticks.push(
      <line
        key={`t${cm}`}
        x1={x}
        y1={ty}
        x2={x + (long ? 8 : 4)}
        y2={ty}
        stroke={long ? '#6C7A93' : '#3A4863'}
        strokeWidth={long ? 1.2 : 0.8}
      />,
    )
    if (long && cm !== 0) {
      ticks.push(
        <text
          key={`l${cm}`}
          x={x + 11}
          y={ty + 3.5}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={9}
        >
          {cm > 0 ? `+${cm}` : cm}
        </text>,
      )
    }
  }
  return (
    <g>
      {/* Phosphor bar */}
      <rect x={x - 2} y={yTop} width={4} height={yBot - yTop} fill="#1A2537" stroke="#3A4863" strokeWidth={1} rx={1} />
      {/* Faint green centerline glow */}
      <line x1={x} y1={yCenter} x2={x} y2={yCenter} stroke="#37C9B8" strokeWidth={2} opacity={0.5} />
      {ticks}
      {/* Impact glow at hit */}
      {hitY !== null && (
        <>
          <circle cx={x} cy={hitY} r={9} fill="#37C9B8" opacity={0.3} />
          <circle cx={x} cy={hitY} r={4} fill="#37C9B8" />
        </>
      )}
    </g>
  )
}
