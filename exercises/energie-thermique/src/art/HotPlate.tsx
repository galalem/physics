/**
 * Hot plate rendered as a metal slab under the beaker. `power` in watts;
 * `active` toggles the glow (used to fade the coil when P is very low).
 * The coil color reflects the applied power (dim → deep orange).
 */
export function HotPlate({
  x,
  y,
  w,
  h,
  power,
  pMin,
  pMax,
}: {
  x: number
  y: number
  w: number
  h: number
  power: number
  pMin: number
  pMax: number
}) {
  // Power ratio in log-space (matches slider mapping)
  const ratio =
    (Math.log(Math.max(power, pMin)) - Math.log(pMin)) /
    (Math.log(pMax) - Math.log(pMin))

  // Coil color: dim grey → orange → bright red-orange
  const coilR = Math.round(80 + 175 * ratio)
  const coilG = Math.round(80 + 60 * ratio)
  const coilB = Math.round(90 - 60 * ratio)
  const coilColor = `rgb(${coilR}, ${coilG}, ${Math.max(30, coilB)})`

  // Slab
  const slabTop = y
  const slabBot = y + h

  return (
    <g>
      {/* Slab body */}
      <rect
        x={x}
        y={slabTop}
        width={w}
        height={h}
        rx={4}
        fill="#1F2A44"
        stroke="#54617A"
        strokeWidth={1.2}
      />
      {/* Coil groove — a wavy line across the top surface */}
      <path
        d={(() => {
          const y0 = slabTop + h * 0.32
          const steps = 8
          const stepW = (w - 20) / steps
          let d = `M ${x + 10} ${y0}`
          for (let i = 1; i <= steps; i++) {
            const dx = x + 10 + i * stepW
            const dy = y0 + (i % 2 === 0 ? 0 : -5)
            d += ` L ${dx} ${dy}`
          }
          return d
        })()}
        fill="none"
        stroke={coilColor}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.6 + 0.4 * ratio}
      />
      {/* Coil glow (radial haze above coil) — grows with power */}
      {ratio > 0.05 && (
        <rect
          x={x + 6}
          y={slabTop - 6}
          width={w - 12}
          height={10}
          rx={4}
          fill={coilColor}
          opacity={0.15 + 0.3 * ratio}
        />
      )}
      {/* Feet */}
      <rect x={x + 4} y={slabBot} width={12} height={4} fill="#3A4863" />
      <rect x={x + w - 16} y={slabBot} width={12} height={4} fill="#3A4863" />
    </g>
  )
}
