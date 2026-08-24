// Cannon — game-y side view.
// { x, y } = trunnion pivot (wheel centre = barrel rotation axis).
// angleRad = barrel elevation (0 = horizontal right, +π/2 = straight up).
// SVG y is down; we negate angleRad internally so positive elevation
// visually points up on screen.
//
// The barrel is fatter at the breech (back) and narrows toward the muzzle.
// The trunnion sits mid-barrel so a real breech extends BEHIND the wheel
// (visible past the wheel's rim) — otherwise the cannon would tip over.
// The wooden wheel is drawn LAST so it visually sits IN FRONT of the barrel.
//
// To swap in more detailed art later: keep the props signature, replace
// the internals of this component.

export function Cannon({ x, y, angleRad }: { x: number; y: number; angleRad: number }) {
  const rotDeg = (-angleRad * 180) / Math.PI
  // Barrel spans from -BREECH_BACK (behind trunnion) to +MUZZLE_FRONT.
  const BREECH_BACK = 16
  const MUZZLE_FRONT = 38
  const breechR = 9 // breech half-height (fatter)
  const muzzleR = 5 // muzzle half-height (narrower)
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Base plate — sits under the wheel on the ground */}
      <rect x={-16} y={0} width={32} height={5} fill="#3E2C1A" rx={1.5} />

      {/* Barrel — rotates with elevation. Drawn BEFORE the wheel so the wheel overlays it. */}
      <g transform={`rotate(${rotDeg})`}>
        {/* Barrel body (trapezoid: fatter breech behind trunnion, narrower muzzle in front) */}
        <polygon
          points={`${-BREECH_BACK},${-breechR} ${MUZZLE_FRONT},${-muzzleR} ${MUZZLE_FRONT},${muzzleR} ${-BREECH_BACK},${breechR}`}
          fill="#2A3244"
          stroke="#0D1524"
          strokeWidth={1.2}
        />
        {/* Breech cap — rounded back end */}
        <circle cx={-BREECH_BACK + 1} cy={0} r={breechR - 0.5} fill="#3A4863" stroke="#0D1524" strokeWidth={1} />
        {/* Reinforcement band near the trunnion */}
        <rect x={-3} y={-breechR - 1.5} width={6} height={2 * breechR + 3} fill="#5A6479" rx={1} />
        {/* Muzzle ring */}
        <rect x={MUZZLE_FRONT - 3} y={-muzzleR - 1.5} width={4} height={2 * muzzleR + 3} fill="#5A6479" rx={0.8} />
        {/* Barrel top highlight — subtle volume */}
        <line
          x1={-BREECH_BACK + 3}
          y1={-breechR + 1.5}
          x2={MUZZLE_FRONT - 2}
          y2={-muzzleR + 1.5}
          stroke="#4A5570"
          strokeWidth={1}
        />
      </g>

      {/* Wooden wheel — drawn LAST so it visually sits in front of the barrel */}
      <g>
        <circle cx={0} cy={0} r={14} fill="#8B6F47" stroke="#5C4326" strokeWidth={1.5} />
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i * Math.PI) / 3
          return (
            <line
              key={i}
              x1={0}
              y1={0}
              x2={Math.cos(a) * 12}
              y2={Math.sin(a) * 12}
              stroke="#5C4326"
              strokeWidth={1.5}
            />
          )
        })}
        <circle cx={0} cy={0} r={3.5} fill="#3E2C1A" />
      </g>
    </g>
  )
}
