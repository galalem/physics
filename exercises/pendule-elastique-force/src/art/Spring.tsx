/**
 * Horizontal spring zigzag between two points.
 * Compresses/stretches with the actual distance — the number of coils is fixed;
 * only their pitch changes.
 */
export function Spring({
  x1,
  x2,
  y,
  coils = 8,
  amp = 8,
  active = false,
}: {
  x1: number
  x2: number
  y: number
  coils?: number
  amp?: number
  active?: boolean
}) {
  const stroke = active ? '#37C9B8' : '#B9C4D6'
  const length = x2 - x1
  // Two straight leads at each end, zigzag in the middle
  const lead = 8
  const zigStart = x1 + lead
  const zigEnd = x2 - lead
  const zigLen = zigEnd - zigStart
  const steps = coils * 2
  const dx = zigLen / steps
  let d = `M ${x1} ${y} L ${zigStart} ${y}`
  for (let i = 1; i <= steps; i++) {
    const px = zigStart + i * dx
    const py = y + (i % 2 === 0 ? -amp : amp)
    d += ` L ${px.toFixed(1)} ${py.toFixed(1)}`
  }
  d += ` L ${zigEnd} ${y} L ${x2} ${y}`
  void length
  return <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" />
}
