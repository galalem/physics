// Spring — vertical coil from (x, yTop) to (x, yBottom).
// Draws N coil turns as a zig-zag path. As yBottom - yTop grows,
// coils stretch further apart (visually communicating elongation).

export function Spring({
  x,
  yTop,
  yBottom,
  coils = 10,
  width = 22,
  strokeWidth = 1.6,
}: {
  x: number
  yTop: number
  yBottom: number
  coils?: number
  width?: number
  strokeWidth?: number
}) {
  const dy = yBottom - yTop
  if (dy <= 0) return null
  const step = dy / (coils * 2)
  const pts: string[] = []
  pts.push(`M ${x} ${yTop}`)
  for (let i = 0; i < coils * 2; i++) {
    const sign = i % 2 === 0 ? 1 : -1
    const yi = yTop + step * (i + 1)
    pts.push(`L ${x + sign * (width / 2)} ${yi - step / 2}`)
    pts.push(`L ${x} ${yi}`)
  }
  return (
    <g>
      <path d={pts.join(' ')} fill="none" stroke="#8FA0BE" strokeWidth={strokeWidth} strokeLinejoin="round" />
    </g>
  )
}
