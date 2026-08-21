import { useCallback, useRef, useState } from 'react'

const W = 500
const H = 380
const S = { x: 58, y: 70 }
const M = { x: 250, y: 250 }
const STARS = [
  { id: 'a', x: 430, y: 150 },
  { id: 'b', x: 356, y: 62 },
] as const
const MIRROR_HALF = 64
const INITIAL_PHI = 0.52

type Vec = { x: number; y: number }

function norm(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y) || 1
  return { x: v.x / l, y: v.y / l }
}

function reflect(phi: number) {
  const n = { x: -Math.sin(phi), y: Math.cos(phi) }
  const d0 = norm({ x: M.x - S.x, y: M.y - S.y })
  const dot = d0.x * n.x + d0.y * n.y
  const r = { x: d0.x - 2 * dot * n.x, y: d0.y - 2 * dot * n.y }
  return { r, n, d0 }
}

function hitStar(r: Vec, star: { x: number; y: number }) {
  const vx = star.x - M.x
  const vy = star.y - M.y
  const t = vx * r.x + vy * r.y
  if (t < 22) return false
  const px = M.x + r.x * t
  const py = M.y + r.y * t
  return Math.hypot(star.x - px, star.y - py) < 17
}

function describeArc(a0: number, a1: number, radius: number) {
  let d = a1 - a0
  while (d <= -Math.PI) d += 2 * Math.PI
  while (d > Math.PI) d -= 2 * Math.PI
  const large = Math.abs(d) > Math.PI ? 1 : 0
  const sweep = d > 0 ? 1 : 0
  const x0 = M.x + radius * Math.cos(a0)
  const y0 = M.y + radius * Math.sin(a0)
  const x1 = M.x + radius * Math.cos(a1)
  const y1 = M.y + radius * Math.sin(a1)
  return `M ${x0} ${y0} A ${radius} ${radius} 0 ${large} ${sweep} ${x1} ${y1}`
}

export function HeroReflectionDemo({ onLitChange }: { onLitChange?: (count: number) => void }) {
  const [phi, setPhi] = useState(INITIAL_PHI)
  const [lit, setLit] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const toSvgPoint = useCallback((clientX: number, clientY: number): Vec | null => {
    const el = svgRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * W,
      y: ((clientY - rect.top) / rect.height) * H,
    }
  }, [])

  const applyPoint = useCallback(
    (p: Vec) => {
      const nextPhi = Math.atan2(p.y - M.y, p.x - M.x)
      setPhi(nextPhi)
      const { r } = reflect(nextPhi)
      setLit((prev) => {
        const next = new Set(prev)
        for (const s of STARS) {
          if (hitStar(r, s)) next.add(s.id)
        }
        if (next.size !== prev.size) onLitChange?.(next.size)
        return next
      })
    },
    [onLitChange],
  )

  const onPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDragging(true)
    const p = toSvgPoint(e.clientX, e.clientY)
    if (p) applyPoint(p)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragging) return
    const p = toSvgPoint(e.clientX, e.clientY)
    if (p) applyPoint(p)
  }
  const endDrag = () => setDragging(false)

  const u = { x: Math.cos(phi), y: Math.sin(phi) }
  const { r, n } = reflect(phi)
  const m1 = { x: M.x - u.x * MIRROR_HALF, y: M.y - u.y * MIRROR_HALF }
  const m2 = { x: M.x + u.x * MIRROR_HALF, y: M.y + u.y * MIRROR_HALF }
  const R2 = { x: M.x + r.x * 1300, y: M.y + r.y * 1300 }

  const aIn = Math.atan2(S.y - M.y, S.x - M.x)
  const aOut = Math.atan2(r.y, r.x)
  const dIn = { x: S.x - M.x, y: S.y - M.y }
  const nSide = dIn.x * n.x + dIn.y * n.y < 0 ? { x: -n.x, y: -n.y } : n
  const aN = Math.atan2(nSide.y, nSide.x)

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{
        display: 'block',
        touchAction: 'none',
        userSelect: 'none',
        borderRadius: '14px',
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <rect x={0} y={0} width={W} height={H} fill="#0D1524" rx={14} />
      {Array.from({ length: Math.floor(W / 40) + 1 }, (_, i) => i * 40).map((gx) => (
        <line key={`gx${gx}`} x1={gx} y1={0} x2={gx} y2={H} stroke="#13223d" strokeWidth={1} />
      ))}
      {Array.from({ length: Math.floor(H / 40) + 1 }, (_, i) => i * 40).map((gy) => (
        <line key={`gy${gy}`} x1={0} y1={gy} x2={W} y2={gy} stroke="#13223d" strokeWidth={1} />
      ))}

      <line
        x1={M.x - n.x * 118}
        y1={M.y - n.y * 118}
        x2={M.x + n.x * 118}
        y2={M.y + n.y * 118}
        stroke="#6C7A93"
        strokeWidth={1.4}
        strokeDasharray="5 6"
      />

      <path d={describeArc(aIn, aN, 32)} fill="none" stroke="#37C9B8" strokeWidth={1.5} />
      <path d={describeArc(aN, aOut, 32)} fill="none" stroke="#37C9B8" strokeWidth={1.5} />

      <line x1={S.x} y1={S.y} x2={M.x} y2={M.y} stroke="rgba(249,115,22,.2)" strokeWidth={9} strokeLinecap="round" />
      <line x1={S.x} y1={S.y} x2={M.x} y2={M.y} stroke="#F97316" strokeWidth={2.4} strokeLinecap="round" />
      <line x1={M.x} y1={M.y} x2={R2.x} y2={R2.y} stroke="rgba(249,115,22,.2)" strokeWidth={9} strokeLinecap="round" />
      <line x1={M.x} y1={M.y} x2={R2.x} y2={R2.y} stroke="#F97316" strokeWidth={2.4} strokeLinecap="round" />

      {STARS.map((s) => {
        const on = lit.has(s.id)
        return (
          <g key={s.id}>
            {on && <circle cx={s.x} cy={s.y} r={18} fill="#37C9B8" opacity={0.22} />}
            <circle cx={s.x} cy={s.y} r={8} fill={on ? '#37C9B8' : 'none'} stroke={on ? '#37C9B8' : '#6C7A93'} strokeWidth={2} />
          </g>
        )
      })}

      <circle cx={S.x} cy={S.y} r={15} fill="#F97316" opacity={0.28} />
      <circle cx={S.x} cy={S.y} r={7.5} fill="#F97316" />

      <g onPointerDown={onPointerDown} style={{ cursor: dragging ? 'grabbing' : 'grab' }}>
        <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} stroke="rgba(234,240,250,.12)" strokeWidth={16} strokeLinecap="round" />
        <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} stroke="#EAF0FA" strokeWidth={3} strokeLinecap="round" />
        <circle cx={m1.x} cy={m1.y} r={5.5} fill="#37C9B8" />
        <circle cx={m2.x} cy={m2.y} r={5.5} fill="#37C9B8" />
      </g>
    </svg>
  )
}
