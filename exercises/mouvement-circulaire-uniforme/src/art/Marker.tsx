// Marker — the moving rim point, plus its live velocity + centripetal
// acceleration arrows. { cx, cy } = disk centre. `theta` = angular
// position in RADIANS (math convention: 0 = +x, CCW positive).
// `rSvg` = orbit radius in SVG units. `vLen` and `aLen` = arrow lengths
// in SVG units (already clamped by caller). `showArrows` gates the
// help vectors (hidden on the blind stage per §4.7). `flash` = brief
// visual pulse when the student CHECKs. The marker itself always
// shows regardless — it's the moving object, not a help vector.

type Props = {
  cx: number
  cy: number
  theta: number
  rSvg: number
  vLen: number
  aLen: number
  showArrows: boolean
  flash: 'hit' | 'miss' | null
}

export function Marker({ cx, cy, theta, rSvg, vLen, aLen, showArrows, flash }: Props) {
  // SVG has y going down, so we flip the y-component of every vector.
  const sinT = Math.sin(theta)
  const cosT = Math.cos(theta)

  // Marker position on the rim (SVG coords)
  const mx = cx + rSvg * cosT
  const my = cy - rSvg * sinT

  // Velocity direction (world tangent, CCW): (-sinT, +cosT)
  // In SVG (y-flipped): (-sinT, -cosT)
  const vx = mx + (-sinT) * vLen
  const vy = my + (-cosT) * vLen

  // Centripetal acceleration direction (world radial inward): (-cosT, -sinT)
  // In SVG: (-cosT, +sinT)
  const ax = mx + (-cosT) * aLen
  const ay = my + sinT * aLen

  const markerFill = flash === 'hit' ? '#37C9B8' : flash === 'miss' ? '#E5484D' : '#F97316'
  const markerHalo =
    flash === 'hit' ? '#37C9B8' : flash === 'miss' ? '#E5484D' : 'transparent'

  return (
    <g>
      {showArrows && (
        <>
          {/* Velocity vector — teal (matches HUD accent) */}
          <ArrowSeg x1={mx} y1={my} x2={vx} y2={vy} color="#37C9B8" width={2.2} />
          <text
            x={vx + (-sinT) * 10}
            y={vy + (-cosT) * 10}
            fill="#37C9B8"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={12}
            textAnchor="middle"
            dominantBaseline="central"
          >
            v
          </text>
          {/* Centripetal acceleration vector — orange */}
          <ArrowSeg x1={mx} y1={my} x2={ax} y2={ay} color="#F97316" width={2.2} />
          <text
            x={ax + (-cosT) * 10}
            y={ay + sinT * 10}
            fill="#F97316"
            fontFamily="'JetBrains Mono', monospace"
            fontSize={12}
            textAnchor="middle"
            dominantBaseline="central"
          >
            a
          </text>
        </>
      )}
      {/* Halo on flash */}
      {flash && <circle cx={mx} cy={my} r={12} fill={markerHalo} opacity={0.35} />}
      {/* The rim marker itself */}
      <circle cx={mx} cy={my} r={5.5} fill={markerFill} stroke="#0D1524" strokeWidth={1.5} />
    </g>
  )
}

function ArrowSeg({
  x1,
  y1,
  x2,
  y2,
  color,
  width,
}: {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
}) {
  // Draw a stroked segment with a small triangular head.
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const headSize = 6
  const bx = x2 - ux * headSize
  const by = y2 - uy * headSize
  const h1x = bx + px * (headSize * 0.6)
  const h1y = by + py * (headSize * 0.6)
  const h2x = bx - px * (headSize * 0.6)
  const h2y = by - py * (headSize * 0.6)
  return (
    <g>
      <line x1={x1} y1={y1} x2={bx} y2={by} stroke={color} strokeWidth={width} strokeLinecap="round" />
      <polygon points={`${x2},${y2} ${h1x},${h1y} ${h2x},${h2y}`} fill={color} />
    </g>
  )
}
