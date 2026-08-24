// Disk — the rotating solid. Center at (cx, cy), rendered radius `radius` in
// SVG units. A reference notch pointing outward at angle 0 makes the rotation
// visible even without markers. `thetaRad` is the current rotation of the disk
// (radians, positive = counter-clockwise on screen — matching physics convention
// with y-axis inverted). Rim + concentric guide rings help the eye read radii.

export function Disk({
  cx,
  cy,
  radius,
  guideRadii,
  thetaRad,
}: {
  cx: number
  cy: number
  radius: number
  guideRadii: number[]
  thetaRad: number
}) {
  const notchLen = radius * 0.14
  const notchWidth = radius * 0.05
  // Notch is drawn in the disk's frame (rotates with the disk). We rotate the
  // whole notch group by -thetaRad in SVG degrees (SVG y is inverted).
  const rotDeg = (-thetaRad * 180) / Math.PI
  return (
    <g>
      {/* Disk body */}
      <circle cx={cx} cy={cy} r={radius} fill="#152238" stroke="#3A4863" strokeWidth={1.5} />
      {/* Concentric guide rings at marker radii */}
      {guideRadii.map((r) => (
        <circle
          key={r}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#22314F"
          strokeWidth={0.8}
          strokeDasharray="3 4"
        />
      ))}
      {/* Reference notch: rotates with the disk */}
      <g transform={`rotate(${rotDeg} ${cx} ${cy})`}>
        <path
          d={`M ${cx + radius} ${cy - notchWidth} L ${cx + radius + notchLen} ${cy} L ${cx + radius} ${cy + notchWidth} Z`}
          fill="#F97316"
          opacity={0.85}
        />
      </g>
      {/* Center axis dot */}
      <circle cx={cx} cy={cy} r={3.5} fill="#EAF0FA" />
      <circle cx={cx} cy={cy} r={1.5} fill="#0D1524" />
    </g>
  )
}
