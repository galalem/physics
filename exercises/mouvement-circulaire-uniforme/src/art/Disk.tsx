// Disk — the circular track the marker orbits on.
// { cx, cy } = centre in SVG units. `rSvg` = radius in SVG units.
// A subtle radial gradient hint + faint tick marks every 30° for
// orientation. Purely decorative — no interaction lives here.

export function Disk({ cx, cy, rSvg }: { cx: number; cy: number; rSvg: number }) {
  const ticks: React.ReactNode[] = []
  for (let i = 0; i < 12; i++) {
    const theta = (i * Math.PI) / 6
    const x1 = cx + Math.cos(theta) * (rSvg - 4)
    const y1 = cy - Math.sin(theta) * (rSvg - 4)
    const x2 = cx + Math.cos(theta) * (rSvg + 4)
    const y2 = cy - Math.sin(theta) * (rSvg + 4)
    ticks.push(
      <line
        key={`tk${i}`}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#3A4863"
        strokeWidth={i % 3 === 0 ? 1.6 : 1}
        opacity={0.55}
      />,
    )
  }
  return (
    <g>
      {/* Faint fill so students can eyeball radial vs tangential */}
      <circle cx={cx} cy={cy} r={rSvg} fill="rgba(55,201,184,0.04)" />
      <circle
        cx={cx}
        cy={cy}
        r={rSvg}
        fill="none"
        stroke="#37C9B8"
        strokeWidth={1.5}
        strokeDasharray="4 4"
        opacity={0.7}
      />
      {ticks}
      {/* Centre dot */}
      <circle cx={cx} cy={cy} r={2.5} fill="#6C7A93" />
    </g>
  )
}
