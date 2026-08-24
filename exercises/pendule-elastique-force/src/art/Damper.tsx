/**
 * Horizontal dashpot (viscous damper) between two points.
 * A cylinder + piston. Cylinder is anchored at x1; piston rod goes to x2.
 */
export function Damper({ x1, x2, y, active = false }: { x1: number; x2: number; y: number; active?: boolean }) {
  const stroke = active ? '#F97316' : '#B9C4D6'
  const cylW = 42
  const cylH = 16
  const cylLeft = x1 + 6
  const cylTop = y - cylH / 2
  const pistonHeadX = cylLeft + cylW * 0.4
  return (
    <g stroke={stroke} strokeWidth={1.6} fill="none" strokeLinecap="round">
      {/* short lead from anchor to cylinder */}
      <line x1={x1} y1={y} x2={cylLeft} y2={y} />
      {/* cylinder body — 3 sides (open on the piston-rod side) */}
      <line x1={cylLeft} y1={cylTop} x2={cylLeft} y2={cylTop + cylH} />
      <line x1={cylLeft} y1={cylTop} x2={cylLeft + cylW} y2={cylTop} />
      <line x1={cylLeft} y1={cylTop + cylH} x2={cylLeft + cylW} y2={cylTop + cylH} />
      {/* piston head — small vertical inside cylinder */}
      <line x1={pistonHeadX} y1={cylTop + 3} x2={pistonHeadX} y2={cylTop + cylH - 3} strokeWidth={2.2} />
      {/* piston rod exiting cylinder to the mass */}
      <line x1={pistonHeadX} y1={y} x2={x2} y2={y} />
    </g>
  )
}
