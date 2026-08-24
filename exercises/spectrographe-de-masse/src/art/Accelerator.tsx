// Accelerator — two parallel plates with a potential difference U across
// them. The ion enters from the left plate (positive) and is accelerated
// to the right toward the negative plate, then flies through the slit.
// { x1, x2, y, height } describe the two plates.

export function Accelerator({
  x1,
  x2,
  y,
  height,
}: {
  x1: number
  x2: number
  y: number
  height: number
}) {
  const plateW = 3
  const halfH = height / 2
  return (
    <g>
      {/* Left plate (+) */}
      <rect
        x={x1 - plateW / 2}
        y={y - halfH}
        width={plateW}
        height={height}
        fill="#F97316"
        stroke="#0D1524"
        strokeWidth={0.8}
        rx={0.8}
      />
      {/* Right plate (−) */}
      <rect
        x={x2 - plateW / 2}
        y={y - halfH}
        width={plateW}
        height={height}
        fill="#37C9B8"
        stroke="#0D1524"
        strokeWidth={0.8}
        rx={0.8}
      />
      {/* +/− polarity marks */}
      <text
        x={x1}
        y={y - halfH - 3}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
      >
        +
      </text>
      <text
        x={x2}
        y={y - halfH - 3}
        fill="#37C9B8"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
      >
        −
      </text>
      {/* Field lines between plates */}
      {Array.from({ length: 4 }).map((_, i) => {
        const yy = y - halfH + (i + 1) * (height / 5)
        return (
          <line
            key={i}
            x1={x1 + 2}
            y1={yy}
            x2={x2 - 4}
            y2={yy}
            stroke="#5A6479"
            strokeWidth={0.6}
            strokeDasharray="2 3"
            markerEnd="url(#accel-arrow)"
          />
        )
      })}
      <defs>
        <marker
          id="accel-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,0 L10,5 L0,10 Z" fill="#5A6479" />
        </marker>
      </defs>
    </g>
  )
}
