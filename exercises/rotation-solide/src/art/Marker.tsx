// Marker — a colored dot pinned to the disk at radius `r` and initial
// angular offset `phi0`. Rotates with the disk (parent group already handles
// rotation). Optional tangent arrow shows current tangential velocity magnitude.

export function Marker({
  x,
  y,
  color,
  label,
  hit,
}: {
  x: number
  y: number
  color: string
  label: string
  hit: boolean
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {hit && <circle cx={0} cy={0} r={13} fill={color} opacity={0.25} />}
      <circle cx={0} cy={0} r={6} fill={color} stroke="#0D1524" strokeWidth={1.5} />
      <text
        x={0}
        y={2.6}
        textAnchor="middle"
        fill="#0D1524"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={7}
        fontWeight={700}
      >
        {label}
      </text>
    </g>
  )
}
