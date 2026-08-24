// TargetChip — a rectangular in-scene card that displays a target
// (v*, a*) pair with a "hit" state. { x, y } = top-left of the chip
// in SVG units. Chips are laid out in the top-left cluster of the
// scene by the caller. `label` (e.g. "T1") disambiguates when the
// student peeks at the target list. `hit` swaps the palette from
// muted to lit, matching the Target bullseye contract in the
// reference exercise.

type Props = {
  x: number
  y: number
  label: string
  vTarget: number
  aTarget: number
  hit: boolean
}

const W = 130
const H = 46

export function TargetChip({ x, y, label, vTarget, aTarget, hit }: Props) {
  const stroke = hit ? '#37C9B8' : '#3A4863'
  const fill = hit ? 'rgba(55,201,184,0.14)' : 'rgba(30,42,64,0.85)'
  const labelColor = hit ? '#37C9B8' : '#6C7A93'
  const valueColor = hit ? '#EAF0FA' : '#B9C4D6'
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={W} height={H} rx={6} fill={fill} stroke={stroke} strokeWidth={1.4} />
      <text
        x={10}
        y={16}
        fill={labelColor}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={9}
        letterSpacing="0.15em"
      >
        {label}
      </text>
      <text
        x={10}
        y={32}
        fill={valueColor}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
      >
        v* = {formatNum(vTarget)}
      </text>
      <text
        x={10}
        y={44}
        fill={valueColor}
        fontFamily="'JetBrains Mono', monospace"
        fontSize={12}
      >
        a* = {formatNum(aTarget)}
      </text>
      {hit && (
        <text
          x={W - 10}
          y={20}
          fill="#37C9B8"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          letterSpacing="0.15em"
          textAnchor="end"
        >
          ✓
        </text>
      )}
    </g>
  )
}

function formatNum(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1)
}
