// TangentArrow — arrow drawn tangent to the disk at (mx, my), a marker
// position. Direction is perpendicular to the radial vector (from disk center
// to marker), pointing in the sense of rotation. Length scales with |v|
// (meters/sec) via `pxPerMps`. Zero-length arrows omit the arrowhead.

export function TangentArrow({
  cx,
  cy,
  mx,
  my,
  vMps,
  omegaSign,
  pxPerMps,
  color = '#37C9B8',
}: {
  cx: number
  cy: number
  mx: number
  my: number
  vMps: number
  omegaSign: number
  pxPerMps: number
  color?: string
}) {
  const rx = mx - cx
  const ry = my - cy
  const rLen = Math.hypot(rx, ry)
  if (rLen < 1) return null
  // Perpendicular to radial: rotate radial (rx, ry) by +90° in SVG (which is
  // CCW in physics because SVG y is inverted → visually CW). For positive ω
  // (physics CCW = visually CCW on screen with our sign convention), we want
  // the arrow to point in the direction of instantaneous motion.
  // Tangent = (-ry, rx) gives CCW on screen (visually CCW).
  const tx = -ry / rLen
  const ty = rx / rLen
  // Sign of ω decides direction of arrow.
  const dir = omegaSign >= 0 ? 1 : -1
  const len = Math.max(0, vMps) * pxPerMps
  if (len < 0.5) return null
  const ex = mx + tx * len * dir
  const ey = my + ty * len * dir
  const headSize = Math.min(9, Math.max(4, len * 0.35))
  // Arrowhead: two lines from tip back at ±30° to the arrow line
  const angle = Math.atan2(ey - my, ex - mx)
  const hx1 = ex - headSize * Math.cos(angle - Math.PI / 7)
  const hy1 = ey - headSize * Math.sin(angle - Math.PI / 7)
  const hx2 = ex - headSize * Math.cos(angle + Math.PI / 7)
  const hy2 = ey - headSize * Math.sin(angle + Math.PI / 7)
  return (
    <g>
      <line x1={mx} y1={my} x2={ex} y2={ey} stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <path d={`M ${ex} ${ey} L ${hx1} ${hy1} L ${hx2} ${hy2} Z`} fill={color} />
    </g>
  )
}
