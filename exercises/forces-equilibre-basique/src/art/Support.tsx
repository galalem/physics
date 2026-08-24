// Support — a fixed ceiling beam with hatch marks below it.
// The spring hangs from a point at (x, y). Beam extends left and right.

export function Support({ x, y, width = 160 }: { x: number; y: number; width?: number }) {
  const half = width / 2
  const beamThickness = 8
  const hatchCount = 10
  return (
    <g>
      {/* Beam */}
      <rect
        x={x - half}
        y={y - beamThickness}
        width={width}
        height={beamThickness}
        fill="#3A4863"
        stroke="#1E2A40"
        strokeWidth={1}
      />
      {/* Hatch marks (fixed reference) */}
      {Array.from({ length: hatchCount }).map((_, i) => {
        const hx = x - half + (i * width) / (hatchCount - 1)
        return (
          <line
            key={i}
            x1={hx}
            y1={y - beamThickness}
            x2={hx - 5}
            y2={y - beamThickness - 6}
            stroke="#54617A"
            strokeWidth={1}
          />
        )
      })}
      {/* Attachment eyelet */}
      <circle cx={x} cy={y} r={3.2} fill="#0D1524" stroke="#8FA0BE" strokeWidth={1.4} />
    </g>
  )
}
