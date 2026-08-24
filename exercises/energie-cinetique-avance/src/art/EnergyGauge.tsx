// EnergyGauge — vertical bar showing live kinetic energy E_c during flight.
// Fills from the bottom. Numeric readout above.
// { x, y } = SVG coord of the bar's top-left corner.
// value / max are in JOULES; fraction is clamped to [0, 1].
// Rendered ONLY on stages 1–2 (help). Hidden on the blind stage 3 per §4.7.

export function EnergyGauge({
  x,
  y,
  width,
  height,
  value,
  max,
  label,
}: {
  x: number
  y: number
  width: number
  height: number
  value: number
  max: number
  label: string
}) {
  const frac = Math.max(0, Math.min(1, value / max))
  const fillH = frac * (height - 4)
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Numeric readout above the bar */}
      <text
        x={width / 2}
        y={-6}
        fill="#F9A968"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={11}
        textAnchor="middle"
      >
        {label}
      </text>
      {/* Bar frame */}
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill="rgba(30,42,64,0.65)"
        stroke="#3A4863"
        strokeWidth={1}
        rx={2}
      />
      {/* Fill — grows from the bottom up */}
      <rect
        x={2}
        y={height - 2 - fillH}
        width={width - 4}
        height={fillH}
        fill="#F97316"
        opacity={0.85}
        rx={1}
      />
      {/* "E_c" caption below */}
      <text
        x={width / 2}
        y={height + 14}
        fill="#6C7A93"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={10}
        textAnchor="middle"
      >
        E_c
      </text>
    </g>
  )
}
