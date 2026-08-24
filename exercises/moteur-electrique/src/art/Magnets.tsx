// Magnets — the two rectangular pole pieces flanking the rotor.
// Horizontal B field arrows go from N (left, blue) → S (right, red).
// { cx, cy } = center of the rotor between them.
// R = rotor tip radius; the magnets sit just outside R with a gap.

export function Magnets({
  cx,
  cy,
  R,
  nLabel,
  sLabel,
}: {
  cx: number
  cy: number
  R: number
  nLabel: string
  sLabel: string
}) {
  const GAP = 22 // clearance between magnet face and rotor circle
  const MAG_W = 62
  const MAG_H = 2 * R + 20
  const nX = cx - R - GAP - MAG_W
  const sX = cx + R + GAP
  const magY = cy - MAG_H / 2
  const faceInnerN = nX + MAG_W
  const faceInnerS = sX
  // Field arrows between the two magnet faces
  const arrowRows = 5
  const arrowSpan = MAG_H - 40
  const arrowStartY = cy - arrowSpan / 2
  const arrows: React.ReactNode[] = []
  for (let i = 0; i < arrowRows; i++) {
    const y = arrowStartY + (arrowSpan / (arrowRows - 1)) * i
    const x1 = faceInnerN + 8
    const x2 = faceInnerS - 8
    arrows.push(
      <g key={`fa${i}`} opacity={0.35}>
        <line x1={x1} y1={y} x2={x2 - 6} y2={y} stroke="#54617A" strokeWidth={1} strokeDasharray="3 3" />
        <polygon
          points={`${x2},${y} ${x2 - 6},${y - 3} ${x2 - 6},${y + 3}`}
          fill="#54617A"
        />
      </g>,
    )
  }
  return (
    <g>
      {/* N magnet (left, blue) */}
      <rect
        x={nX}
        y={magY}
        width={MAG_W}
        height={MAG_H}
        fill="#28406A"
        stroke="#0D1524"
        strokeWidth={1.5}
        rx={4}
      />
      <rect
        x={nX}
        y={magY}
        width={MAG_W}
        height={MAG_H / 2}
        fill="#3B5BA5"
        stroke="none"
        rx={4}
      />
      <text
        x={nX + MAG_W / 2}
        y={cy + 8}
        fill="#EAF0FA"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={28}
        fontWeight={700}
        textAnchor="middle"
      >
        {nLabel}
      </text>

      {/* S magnet (right, red) */}
      <rect
        x={sX}
        y={magY}
        width={MAG_W}
        height={MAG_H}
        fill="#7A2D28"
        stroke="#0D1524"
        strokeWidth={1.5}
        rx={4}
      />
      <rect
        x={sX}
        y={magY}
        width={MAG_W}
        height={MAG_H / 2}
        fill="#B54D45"
        stroke="none"
        rx={4}
      />
      <text
        x={sX + MAG_W / 2}
        y={cy + 8}
        fill="#EAF0FA"
        fontFamily="'JetBrains Mono', monospace"
        fontSize={28}
        fontWeight={700}
        textAnchor="middle"
      >
        {sLabel}
      </text>

      {/* Field arrows N → S */}
      {arrows}
    </g>
  )
}
