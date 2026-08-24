// Mass — the block on the spring. Size subtly reflects m (radius grows with sqrt(m)).
// Center at (x, y).

type Props = {
  x: number
  y: number
  m: number
  mMin: number
  mMax: number
}

export function Mass({ x, y, m, mMin, mMax }: Props) {
  // Half-side scales with sqrt(m / mMax) — visual only, purely decorative.
  const minSide = 14
  const maxSide = 24
  const t = (m - mMin) / (mMax - mMin)
  const clamped = Math.max(0, Math.min(1, t))
  const side = minSide + (maxSide - minSide) * Math.sqrt(clamped)
  const half = side / 2
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x={-half}
        y={-half}
        width={side}
        height={side}
        fill="#1A1F2E"
        stroke="#F97316"
        strokeWidth={1.8}
        rx={2}
      />
      <rect
        x={-half + 3}
        y={-half + 3}
        width={side - 6}
        height={side - 6}
        fill="none"
        stroke="#F9A968"
        strokeWidth={0.8}
        opacity={0.7}
        rx={1.5}
      />
    </g>
  )
}
