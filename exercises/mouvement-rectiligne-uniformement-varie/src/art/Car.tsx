// Car — side-view compact sedan.
// { x, y } = center of the car body in SVG coords. `moving` toggles the
// wheel-spoke tick so it visually rolls while the sim is running.
// To swap in more detailed art later: keep the { x, y, moving } signature.

export function Car({ x, y, moving }: { x: number; y: number; moving: boolean }) {
  // Wheel spoke phase — cycles once every ~0.6s while moving.
  const phase = moving ? ((performance.now() / 6) % 360) : 0
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Chassis body — trapezoid */}
      <polygon
        points={`-26,4 -22,-6 -8,-14 12,-14 22,-6 26,4`}
        fill="#37C9B8"
        stroke="#0D1524"
        strokeWidth={1.2}
      />
      {/* Cabin — inner trapezoid (windows) */}
      <polygon
        points={`-14,-5 -6,-12 10,-12 18,-5`}
        fill="#0D1524"
        stroke="#1FA595"
        strokeWidth={0.8}
      />
      {/* Cabin split (door pillar) */}
      <line x1={2} y1={-12} x2={2} y2={-5} stroke="#1FA595" strokeWidth={0.8} />
      {/* Headlight */}
      <circle cx={24} cy={-1} r={1.6} fill="#F9E68A" />
      {/* Taillight */}
      <rect x={-26} y={-2} width={2.5} height={3} fill="#F97316" rx={0.4} />
      {/* Bumper strip */}
      <line x1={-26} y1={4} x2={26} y2={4} stroke="#0D1524" strokeWidth={1.2} />
      {/* Left wheel */}
      <g transform={`translate(-16 6) rotate(${phase})`}>
        <circle cx={0} cy={0} r={6} fill="#1A1F2E" stroke="#3A4863" strokeWidth={1} />
        <circle cx={0} cy={0} r={2.2} fill="#3A4863" />
        <line x1={-5} y1={0} x2={5} y2={0} stroke="#3A4863" strokeWidth={0.8} />
        <line x1={0} y1={-5} x2={0} y2={5} stroke="#3A4863" strokeWidth={0.8} />
      </g>
      {/* Right wheel */}
      <g transform={`translate(16 6) rotate(${phase})`}>
        <circle cx={0} cy={0} r={6} fill="#1A1F2E" stroke="#3A4863" strokeWidth={1} />
        <circle cx={0} cy={0} r={2.2} fill="#3A4863" />
        <line x1={-5} y1={0} x2={5} y2={0} stroke="#3A4863" strokeWidth={0.8} />
        <line x1={0} y1={-5} x2={0} y2={5} stroke="#3A4863" strokeWidth={0.8} />
      </g>
    </g>
  )
}
