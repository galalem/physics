// Cart — small side-view cart on rails.
// { x, y } = center of the cart body (bottom of body sits on the track).
// `scale` visually reflects mass — heavier cart = larger. Range 0.7..1.4.

export function Cart({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  const bodyW = 44 * scale
  const bodyH = 22 * scale
  const wheelR = 5.5 * scale
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Cart body */}
      <rect
        x={-bodyW / 2}
        y={-bodyH - wheelR + 1}
        width={bodyW}
        height={bodyH}
        rx={3}
        fill="#37C9B8"
        stroke="#1FA595"
        strokeWidth={1.2}
      />
      {/* Front bumper */}
      <rect
        x={bodyW / 2 - 3}
        y={-bodyH - wheelR + 3}
        width={3}
        height={bodyH - 4}
        fill="#1FA595"
      />
      {/* Highlight strip */}
      <rect
        x={-bodyW / 2 + 3}
        y={-bodyH - wheelR + 4}
        width={bodyW - 8}
        height={3}
        fill="#7EE0D2"
        opacity={0.65}
      />
      {/* Wheels */}
      <circle cx={-bodyW / 2 + wheelR + 2} cy={-wheelR + 1} r={wheelR} fill="#2A3244" stroke="#0D1524" strokeWidth={1} />
      <circle cx={bodyW / 2 - wheelR - 2} cy={-wheelR + 1} r={wheelR} fill="#2A3244" stroke="#0D1524" strokeWidth={1} />
      <circle cx={-bodyW / 2 + wheelR + 2} cy={-wheelR + 1} r={wheelR * 0.35} fill="#5A6479" />
      <circle cx={bodyW / 2 - wheelR - 2} cy={-wheelR + 1} r={wheelR * 0.35} fill="#5A6479" />
    </g>
  )
}
