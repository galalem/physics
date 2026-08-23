// PointMarker — a labelled dot on the trajectory. Used for both the moving
// point M(t) and the marked probe points on stage 3.
// `hit` and `wrong` swap the palette after evaluation.

type Props = {
  x: number
  y: number
  label?: string
  radius?: number
  fill?: string
  ring?: string
  state?: 'default' | 'hit' | 'wrong'
}

export function PointMarker({
  x, y, label, radius = 5.5, fill = '#F97316', ring = '#F9A968', state = 'default',
}: Props) {
  let outer = ring
  let inner = fill
  if (state === 'hit') {
    outer = '#37C9B8'
    inner = '#1FA595'
  } else if (state === 'wrong') {
    outer = '#EF4444'
    inner = '#B91C1C'
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cx={0} cy={0} r={radius + 2} fill="none" stroke={outer} strokeWidth={1.5} opacity={0.7} />
      <circle cx={0} cy={0} r={radius} fill={inner} />
      {label && (
        <text
          x={0}
          y={-radius - 6}
          fill="#B9C4D6"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={11}
          textAnchor="middle"
        >
          {label}
        </text>
      )}
    </g>
  )
}
