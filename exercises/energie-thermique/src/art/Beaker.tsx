/**
 * Beaker with water. Origin (x, y) = top-left of the beaker rim.
 * `waterFrac` in [0, 1] visually stays constant at ~0.75 (water level
 * doesn't change with temperature at this level of physics).
 * `tempC` drives the water color (cool blue → warm orange).
 */
export function Beaker({
  x,
  y,
  w,
  h,
  tempC,
  waterFrac = 0.75,
}: {
  x: number
  y: number
  w: number
  h: number
  tempC: number
  waterFrac?: number
}) {
  // Temperature-driven water color: 20°C → deep blue, 100°C → warm orange
  const t = Math.min(1, Math.max(0, (tempC - 20) / 80))
  // Interpolate: cool #2A6DB0 → warm #E85D2E
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
  const r = lerp(0x2a, 0xe8)
  const g = lerp(0x6d, 0x5d)
  const b = lerp(0xb0, 0x2e)
  const waterFill = `rgb(${r}, ${g}, ${b})`
  const waterEdge = `rgb(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)})`

  const waterTop = y + h - waterFrac * h
  const glassStroke = '#B9C4D6'
  const glassW = 2

  // Bubbles begin appearing at ~70°C, dense at 100°C
  const bubbleT = Math.min(1, Math.max(0, (tempC - 70) / 30))
  const showBubbles = bubbleT > 0.02

  // Steam wisps at ~95°C+
  const steamOpacity = Math.min(0.9, Math.max(0, (tempC - 90) / 10))

  return (
    <g>
      {/* Steam wisps rising from beaker rim */}
      {steamOpacity > 0 && (
        <g opacity={steamOpacity}>
          {[0.3, 0.55, 0.75].map((frac, i) => (
            <path
              key={`steam${i}`}
              d={`M ${x + frac * w} ${y - 2} q -6 -10 4 -20 q 10 -10 -2 -22`}
              fill="none"
              stroke="#EAF0FA"
              strokeWidth={1.6}
              strokeLinecap="round"
              opacity={0.75}
            />
          ))}
        </g>
      )}

      {/* Water fill (drawn behind glass so glass edges show) */}
      <rect
        x={x + 2}
        y={waterTop}
        width={w - 4}
        height={y + h - waterTop - 2}
        fill={waterFill}
        opacity={0.85}
      />
      {/* Water top ellipse — subtle meniscus */}
      <ellipse
        cx={x + w / 2}
        cy={waterTop}
        rx={(w - 4) / 2}
        ry={3}
        fill={waterEdge}
        opacity={0.9}
      />

      {/* Bubbles — random-ish stable positions */}
      {showBubbles && (
        <g opacity={0.6 + 0.4 * bubbleT}>
          {[
            { cx: 0.25, cy: 0.85, r: 1.6 },
            { cx: 0.55, cy: 0.75, r: 1.2 },
            { cx: 0.42, cy: 0.9, r: 1.9 },
            { cx: 0.7, cy: 0.82, r: 1.4 },
            { cx: 0.35, cy: 0.68, r: 1.1 },
            { cx: 0.6, cy: 0.92, r: 1.7 },
          ].map((bub, i) => (
            <circle
              key={`b${i}`}
              cx={x + bub.cx * w}
              cy={waterTop + (1 - bub.cy) * (y + h - waterTop) + 4}
              r={bub.r * (0.7 + 0.6 * bubbleT)}
              fill="#EAF0FA"
              opacity={0.75}
            />
          ))}
        </g>
      )}

      {/* Glass walls: U-shape (left side, bottom, right side) */}
      <path
        d={`M ${x} ${y} L ${x} ${y + h} L ${x + w} ${y + h} L ${x + w} ${y}`}
        fill="none"
        stroke={glassStroke}
        strokeWidth={glassW}
        strokeLinejoin="round"
      />
      {/* Rim lip */}
      <line
        x1={x - 4}
        y1={y}
        x2={x + w + 4}
        y2={y}
        stroke={glassStroke}
        strokeWidth={glassW}
        strokeLinecap="round"
      />
    </g>
  )
}
