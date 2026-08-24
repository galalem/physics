// TargetCard — labelled Ec target for the blind stage (gauge hidden).
// Renders as a small pill in SVG at { x, y } (center).
// `hit` toggles palette (teal + glow when hit).

export function TargetCard({
  x,
  y,
  energyJ,
  index,
  hit,
}: {
  x: number
  y: number
  energyJ: number
  index: number
  hit: boolean
}) {
  const w = 96
  const h = 34
  const border = hit ? '#37C9B8' : '#54617A'
  const fill = hit ? 'rgba(55,201,184,0.15)' : '#12203a'
  const textCol = hit ? '#37C9B8' : '#B9C4D6'
  return (
    <g transform={`translate(${x} ${y})`}>
      {hit && <rect x={-w / 2 - 4} y={-h / 2 - 4} width={w + 8} height={h + 8} rx={8} fill="#37C9B8" opacity={0.12} />}
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={6}
        fill={fill}
        stroke={border}
        strokeWidth={1.5}
      />
      <text
        x={-w / 2 + 8}
        y={-2}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={8}
        letterSpacing="1"
      >
        T{index}
      </text>
      <text
        x={-w / 2 + 8}
        y={11}
        fill={textCol}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={13}
        fontWeight={700}
      >
        Ec = {energyJ} J
      </text>
      {hit && (
        <text
          x={w / 2 - 8}
          y={4}
          fill="#37C9B8"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={12}
          textAnchor="end"
        >
          ✓
        </text>
      )}
    </g>
  )
}
