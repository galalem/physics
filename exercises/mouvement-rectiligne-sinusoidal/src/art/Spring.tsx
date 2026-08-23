// Spring — zig-zag coil connecting the anchor wall to the bob.
// Draws a polyline between (x1, y) and (x2, y) with `coils` zig-zags.

type Props = {
  x1: number
  x2: number
  y: number
  coils?: number
  amplitude?: number
  stroke?: string
}

export function Spring({ x1, x2, y, coils = 10, amplitude = 6, stroke = '#6C7A93' }: Props) {
  const dx = x2 - x1
  if (Math.abs(dx) < 2) {
    return <line x1={x1} y1={y} x2={x2} y2={y} stroke={stroke} strokeWidth={1.4} />
  }
  // Small straight lead-in / lead-out, then coils.
  const lead = 6
  const startX = x1 + Math.sign(dx) * lead
  const endX = x2 - Math.sign(dx) * lead
  const span = endX - startX
  const points: string[] = [`${x1},${y}`, `${startX},${y}`]
  const segs = coils * 2
  for (let i = 1; i < segs; i++) {
    const px = startX + (span * i) / segs
    const py = y + (i % 2 === 0 ? 0 : -amplitude)
    points.push(`${px},${py}`)
  }
  points.push(`${endX},${y}`)
  points.push(`${x2},${y}`)
  return <polyline points={points.join(' ')} fill="none" stroke={stroke} strokeWidth={1.4} />
}
