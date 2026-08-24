// EnergyGauge — horizontal bar showing current Ec against a scale.
// { x, y, w, h } = top-left + size of the gauge in SVG units.
// currentJ = current Ec value; maxJ = scale ceiling.
// targets = target Ec zones to render as brackets on the scale.
// hidden = render only an outline/skeleton (blind stage).

type Target = { id: string; energyJ: number; hit: boolean }

export function EnergyGauge({
  x,
  y,
  w,
  h,
  currentJ,
  maxJ,
  targets = [],
  showTargets = false,
  hidden = false,
}: {
  x: number
  y: number
  w: number
  h: number
  currentJ: number
  maxJ: number
  targets?: Target[]
  showTargets?: boolean
  hidden?: boolean
}) {
  const fillFrac = Math.max(0, Math.min(1, currentJ / maxJ))
  const fillW = fillFrac * w

  // Tick marks every 50 J
  const ticks: number[] = []
  for (let v = 0; v <= maxJ; v += 50) ticks.push(v)

  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Track / frame */}
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={4}
        fill={hidden ? 'transparent' : '#12203a'}
        stroke="#3A4863"
        strokeWidth={1.4}
        strokeDasharray={hidden ? '4 5' : undefined}
      />

      {/* Live fill — only when NOT hidden */}
      {!hidden && (
        <>
          <rect
            x={0}
            y={0}
            width={fillW}
            height={h}
            rx={4}
            fill="url(#ec-fill)"
          />
          <defs>
            <linearGradient id="ec-fill" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#F97316" />
              <stop offset="100%" stopColor="#F9A968" />
            </linearGradient>
          </defs>
        </>
      )}

      {/* Tick marks + scale labels — only when NOT hidden */}
      {!hidden &&
        ticks.map((v) => {
          const tx = (v / maxJ) * w
          return (
            <g key={`tick${v}`}>
              <line
                x1={tx}
                y1={h}
                x2={tx}
                y2={h + 4}
                stroke="#6C7A93"
                strokeWidth={1}
              />
              <text
                x={tx}
                y={h + 14}
                fill="#6C7A93"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                textAnchor="middle"
              >
                {v}
              </text>
            </g>
          )
        })}

      {/* Ec caption above the gauge */}
      {!hidden && (
        <text
          x={0}
          y={-6}
          fill="#6C7A93"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          letterSpacing="1"
        >
          Ec (J)
        </text>
      )}
      {hidden && (
        <text
          x={w / 2}
          y={h / 2 + 3}
          fill="#54617A"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={10}
          textAnchor="middle"
          letterSpacing="1"
        >
          Ec — HIDDEN
        </text>
      )}

      {/* Target brackets */}
      {showTargets &&
        targets.map((t) => {
          const tx = Math.max(0, Math.min(w, (t.energyJ / maxJ) * w))
          const color = t.hit ? '#37C9B8' : '#F9A968'
          return (
            <g key={t.id}>
              {/* Vertical bracket */}
              <line x1={tx} y1={-8} x2={tx} y2={h + 8} stroke={color} strokeWidth={1.6} />
              <line x1={tx - 4} y1={-8} x2={tx + 4} y2={-8} stroke={color} strokeWidth={1.6} />
              <line x1={tx - 4} y1={h + 8} x2={tx + 4} y2={h + 8} stroke={color} strokeWidth={1.6} />
              {/* Label above */}
              <text
                x={tx}
                y={-14}
                fill={color}
                fontFamily="'JetBrains Mono', monospace"
                fontSize={10}
                textAnchor="middle"
              >
                {t.energyJ} J
              </text>
              {t.hit && <circle cx={tx} cy={h / 2} r={6} fill="#37C9B8" opacity={0.35} />}
            </g>
          )
        })}
    </g>
  )
}
