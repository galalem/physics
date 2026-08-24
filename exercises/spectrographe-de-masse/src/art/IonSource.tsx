// IonSource — a small chamber with a heated filament and a slit that
// emits the ion beam to the right.
// { x, y } = right-hand outlet (slit centre) in SVG coords. The body
// extends to the LEFT of that point so the beam appears to shoot right.

export function IonSource({ x, y }: { x: number; y: number }) {
  const bodyW = 44
  const bodyH = 32
  const bodyX = x - bodyW
  const bodyY = y - bodyH / 2
  return (
    <g>
      {/* Outer housing */}
      <rect
        x={bodyX}
        y={bodyY}
        width={bodyW}
        height={bodyH}
        fill="#1E2A40"
        stroke="#3A4863"
        strokeWidth={1.5}
        rx={2}
      />
      {/* Inner chamber (darker) */}
      <rect
        x={bodyX + 4}
        y={bodyY + 4}
        width={bodyW - 8}
        height={bodyH - 8}
        fill="#0D1524"
        stroke="#3A4863"
        strokeWidth={0.8}
        rx={1.5}
      />
      {/* Filament glow — the ionising element */}
      <circle cx={bodyX + 12} cy={y} r={4} fill="#F97316" opacity={0.35} />
      <circle cx={bodyX + 12} cy={y} r={1.8} fill="#F9A968" />
      {/* Bracket connecting chamber to slit */}
      <rect
        x={x - 6}
        y={y - 6}
        width={6}
        height={12}
        fill="#3A4863"
        stroke="#0D1524"
        strokeWidth={0.6}
      />
      {/* Slit — small opening the ion escapes through */}
      <rect x={x - 1} y={y - 2.2} width={2} height={4.4} fill="#37C9B8" />
    </g>
  )
}
