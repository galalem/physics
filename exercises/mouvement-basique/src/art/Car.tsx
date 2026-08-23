// Car — simple side-view red sedan.
// { x, y } = bottom-centre of the car body (wheel contact point mid-axle).
// Fly sits on the roof at approx (x, y - carHeight - roofOffset).

export const CAR_W = 100
export const CAR_H = 26
export const CAR_ROOF_H = 14

export function Car({ x, y, dim = false }: { x: number; y: number; dim?: boolean }) {
  const bodyFill = dim ? '#4B2727' : '#C0392B'
  const roofFill = dim ? '#5A2E2E' : '#E74C3C'
  const windowFill = dim ? '#1B2A44' : '#2C4870'
  const wheelFill = dim ? '#1E2438' : '#181C2A'
  const wheelRim = dim ? '#3A4863' : '#6C7A93'
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Body */}
      <rect x={-CAR_W / 2} y={-CAR_H} width={CAR_W} height={CAR_H} fill={bodyFill} rx={4} stroke="#3A4863" strokeWidth={0.8} />
      {/* Roof (trapezoid) */}
      <polygon
        points={`${-CAR_W / 2 + 18},${-CAR_H} ${-CAR_W / 2 + 30},${-CAR_H - CAR_ROOF_H} ${CAR_W / 2 - 30},${-CAR_H - CAR_ROOF_H} ${CAR_W / 2 - 18},${-CAR_H}`}
        fill={roofFill}
        stroke="#3A4863"
        strokeWidth={0.8}
      />
      {/* Window */}
      <polygon
        points={`${-CAR_W / 2 + 22},${-CAR_H - 1} ${-CAR_W / 2 + 32},${-CAR_H - CAR_ROOF_H + 3} ${CAR_W / 2 - 32},${-CAR_H - CAR_ROOF_H + 3} ${CAR_W / 2 - 22},${-CAR_H - 1}`}
        fill={windowFill}
      />
      {/* Headlight */}
      <circle cx={CAR_W / 2 - 4} cy={-CAR_H / 2 - 2} r={2.5} fill={dim ? '#4A4020' : '#FFD34F'} />
      {/* Wheels */}
      <circle cx={-CAR_W / 2 + 20} cy={0} r={7} fill={wheelFill} stroke={wheelRim} strokeWidth={1.2} />
      <circle cx={CAR_W / 2 - 20} cy={0} r={7} fill={wheelFill} stroke={wheelRim} strokeWidth={1.2} />
      <circle cx={-CAR_W / 2 + 20} cy={0} r={2} fill={wheelRim} />
      <circle cx={CAR_W / 2 - 20} cy={0} r={2} fill={wheelRim} />
    </g>
  )
}

// Local coordinate on the roof where the fly sits (relative to car's { x, y })
export const FLY_ROOF_DX = 0
export const FLY_ROOF_DY = -(CAR_H + CAR_ROOF_H + 2)
