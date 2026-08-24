/**
 * Simple thermometer: vertical glass column with a mercury level driven by
 * the current temperature. `tMin` and `tMax` bracket the display range.
 * Origin (x, y) is the center of the bulb at the bottom.
 */
export function Thermometer({
  x,
  y,
  h,
  tempC,
  tMin,
  tMax,
}: {
  x: number
  y: number
  h: number
  tempC: number
  tMin: number
  tMax: number
}) {
  const bulbR = 5.5
  const stemW = 4
  const stemTop = y - h
  const stemBot = y - bulbR - 2
  const stemH = stemBot - stemTop

  const frac = Math.min(1, Math.max(0, (tempC - tMin) / (tMax - tMin)))
  const mercuryTop = stemBot - frac * stemH

  // Mercury color: cool → warm
  const t = Math.min(1, Math.max(0, (tempC - 20) / 80))
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
  const merc = `rgb(${lerp(0xa8, 0xf9)}, ${lerp(0x4a, 0x73)}, ${lerp(0x4a, 0x16)})`

  return (
    <g>
      {/* Stem outline */}
      <rect
        x={x - stemW / 2}
        y={stemTop}
        width={stemW}
        height={stemH + 2}
        rx={2}
        fill="#0D1524"
        stroke="#B9C4D6"
        strokeWidth={1}
      />
      {/* Mercury column */}
      <rect
        x={x - stemW / 2 + 1}
        y={mercuryTop}
        width={stemW - 2}
        height={stemBot - mercuryTop}
        fill={merc}
      />
      {/* Bulb */}
      <circle cx={x} cy={y} r={bulbR} fill={merc} stroke="#B9C4D6" strokeWidth={1} />
      {/* Tick marks (3 evenly spaced) */}
      {[0.25, 0.5, 0.75].map((f, i) => (
        <line
          key={`tk${i}`}
          x1={x + stemW / 2}
          y1={stemBot - f * stemH}
          x2={x + stemW / 2 + 3}
          y2={stemBot - f * stemH}
          stroke="#6C7A93"
          strokeWidth={0.8}
        />
      ))}
    </g>
  )
}
