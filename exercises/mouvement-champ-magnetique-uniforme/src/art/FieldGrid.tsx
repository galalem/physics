// FieldGrid — uniform B field visualization ("B out of page" = dots ⊙).
// Renders a lattice of small "dot-in-a-circle" glyphs across the given
// rectangular region. Read-only, purely decorative.
//
// { x, y, width, height } = rectangular region in SVG coords.
// `spacing` = distance between glyph centres in SVG units.

type Props = { x: number; y: number; width: number; height: number; spacing?: number }

export function FieldGrid({ x, y, width, height, spacing = 42 }: Props) {
  const glyphs: React.ReactNode[] = []
  const cols = Math.floor(width / spacing)
  const rows = Math.floor(height / spacing)
  const offX = (width - cols * spacing) / 2 + spacing / 2
  const offY = (height - rows * spacing) / 2 + spacing / 2
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const cx = offX + c * spacing
      const cy = offY + r * spacing
      if (cx > width - 4 || cy > height - 4) continue
      glyphs.push(
        <g key={`f-${r}-${c}`}>
          <circle cx={cx} cy={cy} r={3.4} fill="none" stroke="#2A3244" strokeWidth={0.8} />
          <circle cx={cx} cy={cy} r={1.1} fill="#37C9B8" opacity={0.55} />
        </g>,
      )
    }
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      {glyphs}
    </g>
  )
}
