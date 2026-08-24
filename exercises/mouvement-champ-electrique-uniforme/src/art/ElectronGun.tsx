// ElectronGun — simple side-view cathode + anode + aperture at the left edge.
// { x, y } = center of the exit aperture (matches the beam entry point).
// Static art; no rotation, no drag. The beam always exits horizontally to the right.

export function ElectronGun({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {/* Body of the gun — tapered tube reaching back to the left */}
      <polygon
        points="-48,-14 -8,-9 -8,9 -48,14"
        fill="#2A3244"
        stroke="#0D1524"
        strokeWidth={1.2}
      />
      {/* Cathode block (back) */}
      <rect x={-52} y={-16} width={6} height={32} fill="#5A6479" stroke="#0D1524" strokeWidth={1} rx={1} />
      {/* Filament glow — hot spot inside the cathode */}
      <circle cx={-49} cy={0} r={2.5} fill="#F97316" opacity={0.7} />
      {/* Focus / anode rings — two vertical bars */}
      <rect x={-32} y={-11} width={2} height={22} fill="#3A4863" />
      <rect x={-20} y={-9} width={2} height={18} fill="#3A4863" />
      {/* Exit aperture — the muzzle opening at (0, 0) */}
      <rect x={-9} y={-4} width={9} height={8} fill="#0D1524" stroke="#5A6479" strokeWidth={1} />
      {/* Small mount base */}
      <rect x={-46} y={14} width={40} height={4} fill="#3E2C1A" rx={1} />
    </g>
  )
}
