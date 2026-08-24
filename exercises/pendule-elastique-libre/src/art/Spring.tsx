// Spring — zig-zag coil connecting anchor to mass, horizontal orientation.
// (x1, y) = anchor point; (x2, y) = mass attachment point.
// `stiffness` visually maps to number of coils — stiffer spring → tighter coils.

type Props = {
  x1: number
  x2: number
  y: number
  coils?: number
  amplitude?: number
  stroke?: string
}

export function Spring({ x1, x2, y, coils = 12, amplitude = 8, stroke = '#6C7A93' }: Props) {
  const dx = x2 - x1
  if (Math.abs(dx) < 2) {
    return <line x1={x1} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={1.6} />
  }
  const lead = 8
  const startX = x1 + Math.sign(dx) * lead
  const endX = x2 - Math.sign(dx) * lead
  const span = endX - startX
  const points: string[] = [`${x1},${y}`, `${startX},${y}`]
  const segs = coils * 2
  for (let i = 1; i < segs; i++) {
    const px = startX + (span * i) / segs
    const py = y + (i % 2 === 0 ? 0 : -amplitude)
    points.push(`${px.toFixed(2)},${py.toFixed(2)}`)
  }
  points.push(`${endX},${y}`)
  points.push(`${x2},${y}`)
  return <polyline points={points.join(' ')} fill="none" stroke={stroke} strokeWidth={1.6} />
}
