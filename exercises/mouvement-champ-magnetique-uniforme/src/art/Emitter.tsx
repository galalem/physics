// Emitter — a fixed particle source at the left edge of the B-field region.
// { x, y } = emitter aperture position (in SVG coords). Particle exits
// horizontally toward +x with speed v.
//
// Visual: a short chamber with a slit aperture and a small ground plate,
// stylistically consistent with the launcher-based patterns of the
// 2d-trajectory-launcher family.

export function Emitter({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Chamber body — sits behind the aperture */}
      <rect x={-30} y={-14} width={26} height={28} fill="#2A3244" stroke="#0D1524" strokeWidth={1.2} rx={2} />
      {/* Coils around the chamber (accelerator hint) */}
      <line x1={-28} y1={-10} x2={-6} y2={-10} stroke="#5A6479" strokeWidth={1} />
      <line x1={-28} y1={-4} x2={-6} y2={-4} stroke="#5A6479" strokeWidth={1} />
      <line x1={-28} y1={2} x2={-6} y2={2} stroke="#5A6479" strokeWidth={1} />
      <line x1={-28} y1={8} x2={-6} y2={8} stroke="#5A6479" strokeWidth={1} />
      {/* Aperture ring at the muzzle */}
      <rect x={-6} y={-6} width={4} height={12} fill="#3A4863" stroke="#0D1524" strokeWidth={1} rx={0.5} />
      {/* Slit — where particle exits */}
      <line x1={-4} y1={-3} x2={-4} y2={3} stroke="#F97316" strokeWidth={1.5} />
      {/* Base pedestal */}
      <rect x={-32} y={14} width={30} height={3} fill="#3E2C1A" rx={1} />
    </g>
  )
}
