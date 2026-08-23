// Track — horizontal rail with tick marks and coordinate labels.
// Ticks every 5 m. Numbered every 10 m. Range from xMin to xMax (meters).

export function Track({
  xMin,
  xMax,
  yPx,
  toSvgX,
}: {
  xMin: number
  xMax: number
  yPx: number
  toSvgX: (m: number) => number
}) {
  const ticks: number[] = []
  for (let m = xMin; m <= xMax; m += 5) ticks.push(m)

  return (
    <g>
      {/* main rail */}
      <line
        x1={toSvgX(xMin)}
        y1={yPx}
        x2={toSvgX(xMax)}
        y2={yPx}
        stroke="#3A4863"
        strokeWidth={2}
      />
      {/* shadow bar */}
      <rect
        x={toSvgX(xMin)}
        y={yPx + 3}
        width={toSvgX(xMax) - toSvgX(xMin)}
        height={4}
        fill="#12203a"
      />
      {ticks.map((m) => {
        const px = toSvgX(m)
        const major = m % 10 === 0
        return (
          <g key={`t${m}`}>
            <line
              x1={px}
              y1={yPx}
              x2={px}
              y2={yPx + (major ? 10 : 5)}
              stroke="#3A4863"
              strokeWidth={major ? 1.4 : 0.8}
            />
            {major && (
              <text
                x={px}
                y={yPx + 22}
                fill="#54617A"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                {m}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
